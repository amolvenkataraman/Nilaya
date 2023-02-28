from django.apps import AppConfig

class SchedulerConfig(AppConfig):
    name = 'scheduler'
    verbose_name = 'Calendar'

    def ready(self):
        import Comptech.celery

