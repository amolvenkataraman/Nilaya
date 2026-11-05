"""Run a migration operation's SQL on PostgreSQL only (production).

The migration *state* is applied on every database, so Django sees the same
schema everywhere and never generates new migrations; only the database work
is skipped elsewhere (SQLite, used for local testing).
"""

from django.db.migrations.operations.base import Operation


class PostgresOnly(Operation):
    reversible = True

    def __init__(self, operation):
        self.operation = operation

    def deconstruct(self):
        return (self.__class__.__qualname__, [self.operation], {})

    def state_forwards(self, app_label, state):
        self.operation.state_forwards(app_label, state)

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        if schema_editor.connection.vendor == "postgresql":
            self.operation.database_forwards(app_label, schema_editor, from_state, to_state)

    def database_backwards(self, app_label, schema_editor, from_state, to_state):
        if schema_editor.connection.vendor == "postgresql":
            self.operation.database_backwards(app_label, schema_editor, from_state, to_state)

    def describe(self):
        return f"{self.operation.describe()} (PostgreSQL only)"
