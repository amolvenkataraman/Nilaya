from django.http import JsonResponse
import random
import string

def success_response(message="OK"):
    return JsonResponse({"status": "success", "data": message}, status=200)

def error_response(message, code=400):
    return JsonResponse({"status": "error", "data": message}, status=code)

def random_characters(length=32):
    return ''.join(random.choice(string.ascii_uppercase + string.ascii_lowercase + string.digits + '-_') for _ in range(length))
