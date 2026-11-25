"""Write the V2 API's OpenAPI schema to frontend/src/lib/api-schema.json, which the React app's types are
generated from (`npm run api:types`). No server, database or cache needed: it only walks the routers.

    manage.py api_schema              # write the file
    manage.py api_schema -o -         # print it instead

Two things differ from ninja's own export_openapi_schema, so the generated types match what the API sends:
- Names. ninja keys components by class name, so same-named schemas from two apps (tasks' and contacts'
  UserBrief, map's and scheduler's PlaceOut, ...) overwrite each other and every $ref to the loser points at the
  winner's shape. Each name used by more than one class gets its app as a prefix (TasksUserBrief,
  ContactsUserBrief); unique names stay as they are.
- Defaults. A response always carries fields that have a default (`comments: int = 0`), so in responses they're
  required, not optional. A class that requests (or a route with exclude_none and the like) use too, where those
  fields may be missing, keeps its name for that shape and gets pydantic's "-Output" suffix for the response one
  (Address and Address-Output).
Keys are sorted, so the file only changes when the API does (mainsite/tests.py fails while it's stale).
"""

import json
import sys
from pathlib import Path
from typing import get_args

from django.conf import settings
from django.core.management.base import BaseCommand
from ninja.openapi.schema import REF_TEMPLATE, OpenAPISchema
from ninja.responses import NinjaJSONEncoder
from ninja.schema import NinjaGenerateJsonSchema
from pydantic import BaseModel

OUTPUT = Path(settings.BASE_DIR) / "frontend" / "src" / "lib" / "api-schema.json"


def _models(tp, found: set) -> set:
    """Every pydantic model reachable from a type: the model, its fields' types, and list/Optional/dict arguments."""
    if isinstance(tp, type) and not get_args(tp) and issubclass(tp, BaseModel):
        if tp not in found:
            found.add(tp)
            for field in tp.model_fields.values():
                _models(field.annotation, found)
    else:
        for arg in get_args(tp):
            _models(arg, found)
    return found


def _rename_refs(node, refs: dict):
    if not refs:
        return node
    if isinstance(node, dict):
        return {k: refs.get(v, v) if k == "$ref" else _rename_refs(v, refs) for k, v in node.items()}
    if isinstance(node, list):
        return [_rename_refs(v, refs) for v in node]
    return node


def _sends_defaults(op) -> bool:
    return not (op.exclude_unset or op.exclude_defaults or op.exclude_none)


def _has_defaults(cls) -> bool:
    return any(not f.is_required() for f in cls.model_fields.values())


class SentDefaultsRequired(NinjaGenerateJsonSchema):
    """Response schemas with fields that have defaults marked required: the response always includes them."""

    def field_is_required(self, field, total: bool) -> bool:
        if self.mode == "serialization":
            return field.get("serialization_exclude_if") is None
        return super().field_is_required(field, total)


class ApiSchema(OpenAPISchema):
    """ninja's schema builder with unique component names and response defaults required (see the module docstring)."""

    def __init__(self, api, path_prefix: str):
        classes: dict[str, set] = {}
        optional_shape, sent_shape = set(), set()  # classes used where defaulted fields may be missing / are sent
        for router in api._get_bound_routers():
            for view in router.path_operations.values():
                for op in view.operations:
                    sent = sent_shape if _sends_defaults(op) else optional_shape
                    for model, used in [*((m, optional_shape) for m in op.models),
                                        *((m, sent) for m in op.response_models.values())]:
                        for cls in _models(model, set()):
                            classes.setdefault(cls.__name__, set()).add(cls)
                            used.add(cls)
        self.clashing = {name for name, found in classes.items() if len(found) > 1}
        self.two_shapes = {cls for cls in optional_shape & sent_shape if _has_defaults(cls)}
        self.sending_defaults = False  # inside responses() for a route that sends every field
        self.names: dict[str, str] = {}  # for the model being converted: pydantic's component name -> ours
        super().__init__(api, path_prefix)

    def responses(self, operation):
        self.sending_defaults = _sends_defaults(operation)
        try:
            return super().responses(operation)
        finally:
            self.sending_defaults = False

    def _create_schema_from_model(self, model, by_alias=True, remove_level=True, mode="validation"):
        # ninja's version with our generator and names. One pydantic run never holds two classes with the same
        # short name (it qualifies those itself), so within it a name maps to one class.
        sent = mode == "serialization" and self.sending_defaults
        self.names = {}
        for cls in _models(model, set()):
            name = cls.__name__
            new = (cls.__module__.split(".")[0].capitalize() + name if name in self.clashing else name) + (
                "-Output" if sent and cls in self.two_shapes else "")
            if new != name:
                self.names[name] = new
        if hasattr(model, "__ninja_flatten_map__"):
            schema = self._flatten_schema(model)
        else:
            schema = model.model_json_schema(
                ref_template=REF_TEMPLATE,
                by_alias=by_alias,
                schema_generator=SentDefaultsRequired if sent else NinjaGenerateJsonSchema,
                mode=mode,
            ).copy()
        refs = {REF_TEMPLATE.format(model=old): REF_TEMPLATE.format(model=new) for old, new in self.names.items()}
        if schema.get("$defs"):
            self.add_schema_definitions(
                {self.names.get(k, k): _rename_refs(v, refs) for k, v in schema.pop("$defs").items()})
        schema = _rename_refs(schema, refs)
        if remove_level and len(schema["properties"]) == 1:
            name, details = next(iter(schema["properties"].items()))
            return details, name in schema.get("required", ())
        return schema, True


def render() -> str:
    from Comptech.api_v2 import api

    schema = ApiSchema(api, api.get_root_path({}))
    return json.dumps(schema, cls=NinjaJSONEncoder, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


class Command(BaseCommand):
    help = "Write the V2 API's OpenAPI schema to frontend/src/lib/api-schema.json (or -o PATH, '-' for stdout)"

    def add_arguments(self, parser):
        parser.add_argument("-o", "--output", default=str(OUTPUT))

    def handle(self, *, output, **_):
        text = render()
        if output == "-":
            sys.stdout.write(text)
        else:
            Path(output).write_text(text)
            self.stdout.write(f"Wrote {output}")
