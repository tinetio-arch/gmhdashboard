# Multi-Provider Healthie Setup

## Environment Variables Needed

Add these to `/home/ec2-user/.env.production`:

```bash
# Healthie API (already have)
HEALTHIE_API_KEY=b50e4cc13e6cfda3ac7d4c4aee3a4a366d7c96e7c5f5a22e

# Provider IDs (get from Healthie)
HEALTHIE_MENS_HEALTH_PROVIDER_ID=provider_123
HEALTHIE_PRIMARY_CARE_PROVIDER_ID=provider_456

# Appointment Type IDs (get from Healthie)
HEALTHIE_APPT_TYPE_NEW_PATIENT=appt_type_1
HEALTHIE_APPT_TYPE_FOLLOWUP=appt_type_2
HEALTHIE_APPT_TYPE_LABS=appt_type_3
HEALTHIE_APPT_TYPE_URGENT=appt_type_4
```

## How to Get Provider IDs from Healthie

### Option 1: GraphQL Query
```graphql
query {
  providers {
    id
    full_name
    npi
  }
}
```

### Option 2: Healthie UI
1. Log into Healthie
2. Go to Settings → Providers
3. Click on each provider
4. Provider ID is in the URL: `healthie.com/providers/{ID}`

## How Multiple Providers Work

### Voice AI Flow:
```
Caller: "I want to schedule with Dr. Whitten"
AI: *uses verify_patient action*
AI: *calls get_availability with provider_name="Dr. Whitten"*
AI: "I have these times available with Dr. Whitten: ..."
Caller: "I'll take 10am on Tuesday"
AI: *calls book_appointment with provider_id for Dr. Whitten*
AI: "You're all set! Appointment booked with Dr. Whitten."
```

### Provider Selection Logic:

1. **By Service Line** (automatic):
   - Calls to Men's Health number → Dr. Whitten
   - Calls to Primary Care number → Other provider

2. **By Patient Preference** (if stored in GHL):
   ```javascript
   const preferredProvider = contact.customField
     .find(f => f.key === 'preferred_provider')?.value;
   ```

3. **By Caller Request**:
   - AI asks: "Which doctor would you like to see?"
   - Passes provider name to `get_availability`

## Testing Before Healthie Rate Limits Clear

The webhook server is built to work with mock data now, then seamlessly switch to real Healthie API once rate limits clear.

**Current behavior**: Returns mock availability slots
**After rate limits clear**: Just uncomment the Healthie API calls

## Next Steps

1. **Get Provider IDs**: Run GraphQL query in Healthie
2. **Add to .env**: Update environment variables
3. **Get Appointment Type IDs**: Query Healthie for your configured types
4. **Test Mock Booking**: Use curl to test webhook endpoints
5. **Configure Voice AI**: Add custom actions in GHL
6. **Wait for Rate Limits**: Switch to live Healthie API

Ready for me to help you get the Provider IDs from Healthie?
