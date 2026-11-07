"""/api/v2/calendar/: calendars you're subscribed to and their events.

Roles come from Calendar.owner (owner) and Subscriber.subscribe_type (admin or
subscriber): owners and admins edit, subscribers read, everyone else gets 404.
Event ids are uuids, or "<series uuid>:<original start, UTC ISO>" for occurrences of
a repeating event; PATCH/DELETE take ?scope=this|following|all for those.
"""

from ninja import Router

from . import api_calendars, api_events, api_insights

# The routes live in api_calendars (calendars, subscribers, invites, categories), api_events (events,
# attendees) and api_insights (agenda, availability, insights); shared schemas/helpers in api_common.
router = Router(tags=["calendar"])
router.add_router("", api_calendars.router)
router.add_router("", api_events.router)
router.add_router("", api_insights.router)
