from django.db import models
from django.http import JsonResponse
import logging
import random
import string
import secrets

# Return a success response in JSON format
def success_response(message: str="OK"):
    return JsonResponse({"status": "success", "data": message}, status=200)

# Return an error response in JSON format
def error_response(message: str, code: int=400):
    return JsonResponse({"status": "error", "data": message}, status=code)

def server_error(ex: Exception):
    """Log the full traceback server-side; never send exception details to the client."""
    logging.getLogger("comptech").error("Unhandled %s", type(ex).__name__, exc_info=ex)
    return error_response("Something went wrong on the server.", 500)

# Return a string of random characters of a desired length
def random_characters(length: int=32):
    return secrets.token_urlsafe(length)

# Decorator for requiring login for APIs
def login_required_api(func):
    def wrapper(request, *args, **kwargs):
        if request.user.is_authenticated:
            return func(request, *args, **kwargs)
        else:
            return error_response("Not logged in", 401)
    return wrapper

# Decorator for allowing POST requests for API routes
def post_request_only(func):
    def wrapper(request, *args, **kwargs):
        if request.method == 'POST':
            return func(request, *args, **kwargs)
        else:
            return error_response("Method not allowed", 405)
    return wrapper

# Creates a JSON object with the requested attributes of the provided object
def get_model_attrs(obj, attrs: list):
    ans = {}

    for attr in attrs:
        temp = getattr(obj, attr)
        if isinstance(temp, models.DateField) or isinstance(temp, models.DateTimeField): temp = str(temp)
        ans[attr] = temp
    
    return ans
