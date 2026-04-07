## 📋 APPENDIX: COMMON QUERIES

### Find Patient in Healthie
```typescript
import { query } from '@/lib/db';

const patients = await query(
  `SELECT patient_id, patient_name, healthie_client_id 
   FROM patient_data_entry_v 
   WHERE patient_name ILIKE $1 
   LIMIT 10`,
  [`%${searchTerm}%`]
);
```

### Check QuickBooks Connection
```typescript
import { getQuickBooksClient } from '@/lib/quickbooks';

const qb = await getQuickBooksClient();
const companyInfo = await qb.getCompanyInfo();
// Returns: { CompanyName, LegalName, ... }
```

### Query Snowflake from Script
```python
import snowflake.connector
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend
import os

with open(os.path.expanduser('~/.snowflake/rsa_key_new.p8'), 'rb') as f:
    p_key = serialization.load_pem_private_key(f.read(), password=None, backend=default_backend())
pkb = p_key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())

conn = snowflake.connector.connect(
    account='KXWWLYZ-DZ83651',
    user='JARVIS_SERVICE_ACCOUNT',
    private_key=pkb,
    warehouse='GMH_WAREHOUSE',
    database='GMH_CLINIC',
    schema='PATIENT_DATA'
)

cursor = conn.cursor()
cursor.execute("SELECT COUNT(*) FROM PATIENTS")
print(cursor.fetchone()[0])
```

---

**End of Source of Truth Document**

*For questions or clarifications, review this document first. If still unclear, check:*
1. *PM2 logs: `pm2 logs gmh-dashboard`*
2. *Scribe logs: `/tmp/scribe_*.log`*
3. *Sync logs: `/home/ec2-user/logs/snowflake-sync.log`*
4. *Nginx logs: `/var/log/nginx/error.log`*

*This document is maintained by AntiGravity AI Assistant and should be updated after major changes.*

---

