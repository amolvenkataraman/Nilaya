from django.db import models
from users.models import *
import uuid

# Create your models here.
def parse_upload_path(instance, filename):
    return f"sm_posts/{instance.id}/{filename}"

class Post(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    posted_by = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='post_posted_by')
    posted_on = models.DateTimeField(auto_now=True)
    description = models.CharField(max_length=256, null=True, blank=True)
    location = models.CharField(max_length=64, null=True, blank=True)
    no_files = models.IntegerField(default=0)
    file1 = models.FileField(upload_to=parse_upload_path, null=True, blank=True)
    file2 = models.FileField(upload_to=parse_upload_path, null=True, blank=True)
    file3 = models.FileField(upload_to=parse_upload_path, null=True, blank=True)
    file4 = models.FileField(upload_to=parse_upload_path, null=True, blank=True)
    file5 = models.FileField(upload_to=parse_upload_path, null=True, blank=True)
    file6 = models.FileField(upload_to=parse_upload_path, null=True, blank=True)
    file7 = models.FileField(upload_to=parse_upload_path, null=True, blank=True)
    file8 = models.FileField(upload_to=parse_upload_path, null=True, blank=True)
    file9 = models.FileField(upload_to=parse_upload_path, null=True, blank=True)
    file10 = models.FileField(upload_to=parse_upload_path, null=True, blank=True)

    def __str__(self):
        return f"{self.posted_by.username}'s post on {self.posted_on}. [{self.description[:20]}]"

    def getinfo(self):
        ans = {
            "id": str(self.id),
            "posted_by": self.posted_by.getinfo_zip(),
            "posted_on": str(self.posted_on),
            "description": self.description,
            "location": self.location,
            "no_files": self.no_files,
            "files": []
        }
        if self.file1: ans["files"].append(self.file1.url)
        if self.file2: ans["files"].append(self.file2.url)
        if self.file3: ans["files"].append(self.file3.url)
        if self.file4: ans["files"].append(self.file4.url)
        if self.file5: ans["files"].append(self.file5.url)
        if self.file6: ans["files"].append(self.file6.url)
        if self.file7: ans["files"].append(self.file7.url)
        if self.file8: ans["files"].append(self.file8.url)
        if self.file9: ans["files"].append(self.file9.url)
        if self.file10: ans["files"].append(self.file10.url)

        return ans

class PostLike(models.Model):
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='post_like_post')
    liked_by = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='post_like_liked_by')
    liked_on = models.DateTimeField(auto_now=True)

    def getinfo(self):
        return {
            "post": self.post.id,
            "liked_by": self.liked_by.username,
            "liked_on": str(self.liked_on)
        }

class PostComment(models.Model):
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='post_comment_post')
    commented_by = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='post_comment_commented_by')
    commented_on = models.DateTimeField(auto_now=True)
    comment = models.CharField(max_length=2048, null=True, blank=True)
    parent = models.ForeignKey("self", on_delete=models.CASCADE, null=True, blank=True, related_name='post_comment_parent')
    deleted = models.BooleanField(default=False)

    def getinfo(self):
        return {
            "post": self.post.id,
            "commented_by": self.commented_by.username,
            "commented_on": str(self.commented_on),
            "comment": self.comment,
            "parent": self.parent.id if self.parent else None,
            "deleted": self.deleted
        }

