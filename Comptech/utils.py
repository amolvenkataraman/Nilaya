from django.http import JsonResponse

def success_response(message="OK"):
    return JsonResponse({"status": "success", "data": message}, status=200)

def error_response(message, code=400):
    return JsonResponse({"status": "error", "data": message}, status=code)