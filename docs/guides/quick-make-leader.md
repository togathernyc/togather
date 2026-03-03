# Quick Guide: Make testuser4_1@test.com a Leader

## Quick Steps

1. **Open Django shell:**
   ```bash
   cd apps/backend
   python manage.py shell
   ```

2. **Copy and paste this code:**
   ```python
   from member.models import User, Membership
   from dinner.models import Dinner
   
   user = User.objects.filter(email='testuser4_1@test.com').first()
   dinner = Dinner.objects.filter(is_archived=False).first()
   
   membership, created = Membership.objects.get_or_create(
       user=user,
       dinner_group=dinner
   )
   
   membership.role = Membership.LEADER
   membership.active = True
   membership.request_status = Membership.ACCEPTED
   membership.save()
   
   print(f'✓ Made {user.email} leader of {dinner.title}')
   ```

3. **Log out and log back in** in the mobile app as `testuser4_1@test.com`

4. **Navigate to Leader Tools** - you should now see the group!

## Alternative: Run Script File

```bash
cd apps/backend
python manage.py shell < ../scripts/make_user_leader_simple.py
```

## Need a Specific Group ID?

If you want to assign to a specific group:

```python
dinner = Dinner.objects.get(id=YOUR_GROUP_ID)  # Replace YOUR_GROUP_ID
```

## Verify It Worked

```python
from member.models import User, Membership
user = User.objects.get(email='testuser4_1@test.com')
leaders = Membership.objects.filter(user=user, role=Membership.LEADER, active=True)
for m in leaders:
    print(f"Leader of: {m.dinner_group.title}")
```

