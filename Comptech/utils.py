from django.http import JsonResponse
import random
import string
import secrets

def success_response(message="OK"):
    return JsonResponse({"status": "success", "data": message}, status=200)

def error_response(message, code=400):
    return JsonResponse({"status": "error", "data": message}, status=code)

def random_characters(length=32):
    # return ''.join(random.choice(string.ascii_uppercase + string.ascii_lowercase + string.digits + '-_') for _ in range(length))
    return secrets.token_urlsafe(length)

def login_required_api(func):
    def wrapper(request, *args, **kwargs):
        if request.user.is_authenticated:
            return func(request, *args, **kwargs)
        else:
            return error_response("Not logged in", 401)
    return wrapper

def post_request_only(func):
    def wrapper(request, *args, **kwargs):
        if request.method == 'POST':
            return func(request, *args, **kwargs)
        else:
            return error_response("Method not allowed", 405)
    return wrapper
