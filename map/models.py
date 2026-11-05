from django.db import models
from users.models import *
from django.core.validators import MinValueValidator, MaxValueValidator
import uuid  # Add import for UUID


class LocationGroup(models.Model):
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='location_groups')
    is_public = models.BooleanField(default=False)
    archived = models.BooleanField(default=False)  # owner: hide everywhere (like a disabled calendar)

    def __str__(self):
        return self.name


class GroupPreference(models.Model):
    """Per person: whether a group's places are shown on their map. Hidden by default, so a map with
    thousands of places only loads the groups someone turned on (like calendar visibility)."""
    user = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='place_group_prefs')
    group = models.ForeignKey(LocationGroup, on_delete=models.CASCADE, related_name='preferences')
    visible = models.BooleanField(default=False)

    class Meta:
        unique_together = [('user', 'group')]


class Location(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    CATEGORY_CHOICES = [
        ('house', 'House'),
        ('business', 'Business'),

        ('school', 'School'),
        ('university', 'University'),

        ('restaurant', 'Restaurant'),
        ('shop', 'Shop'),
        ('mall', 'Shopping Mall'),

        ('parking', 'Parking'),
        ('religious', 'Religious'),
        ('hospital', 'Hospital'),
        ('transit', 'Transit'),

        ('park', 'Park'),
        ('nature', 'Nature'),

        ('other', 'Other'),
    ]

    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    latitude = models.DecimalField(
        max_digits=9, 
        decimal_places=6,
        validators=[
            MinValueValidator(-90),
            MaxValueValidator(90)
        ]
    )
    longitude = models.DecimalField(
        max_digits=9, 
        decimal_places=6,
        validators=[
            MinValueValidator(-180),
            MaxValueValidator(180)
        ]
    )
    altitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default='other')
    address = models.TextField(null=True, blank=True)
    group = models.ForeignKey(LocationGroup, on_delete=models.CASCADE, related_name='locations')
    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)],
        null=True,
        blank=True
    )
    notes = models.TextField(blank=True)

    STATUS_CHOICES = [
        ('saved', 'Saved'),
        ('want_to_go', 'Want to go'),
        ('visited', 'Visited'),
    ]
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='saved')
    visited_on = models.DateField(null=True, blank=True)
    updated_on = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['name']
        indexes = [
            models.Index(fields=['latitude', 'longitude']),
            models.Index(fields=['category']),
        ]
