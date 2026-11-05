"""{% load photos_hidden %} … {% if request|show_hidden %}: whether show-hidden mode is on (see photos/hidden.py)."""
from django import template

from photos.hidden import show_hidden as _show_hidden

register = template.Library()


@register.filter
def show_hidden(request):
    return _show_hidden(request)
