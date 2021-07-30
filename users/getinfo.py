from users.models import *

def getinfo(model, e):
    ans = {}
    for i in e:
        ans[i] = getattr(model, i)

    return ans

