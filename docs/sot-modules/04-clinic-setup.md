| uptime-monitor | python3 | - | Real-time PM2/Website Monitoring |

---

## 🏥 CLINIC SETUP (DEEP DIVE JAN 2026)

### Locations
**1. NOW Primary Care** (ID: `13023235`)
- **Address**: 212 S Montezuma, Prescott, AZ 86303
- **Focus**: Primary Care, Sick Visits, Annual Physicals
- **Key Patient Types**: Membership (Elite/Premier), Urgent Care

**2. NOW Men's Health** (ID: `13029260`)
- **Address**: 215 N McCormick, Prescott, AZ 86301
- **Focus**: TRT, Hormone Optimization, Weight Loss
- **Key Patient Types**: Men's Health, EvexiPel, Weight Loss

### Key Providers
- **Phil Schafer NP** (ID: `12088269`): Works across **BOTH** locations (Men's Health, Primary Care, Weight Loss).
- **Dr. Aaron Whitten** (ID: `12093125`): Medical Director (Men's Health focus).

### Service Workflows
- **Men's Health**: `Initial Male Hormone Replacement Consult`, `EvexiPel Procedure`, `TRT Supply Refill`.
- **Primary Care**: `Annual Physical`, `Sick Visit`, `Elite/Premier Membership Consult`.
- **Weight Loss**: `Weight Loss Consult` (45m), `Weight Loss Injection`.

### Intake Flows (Source of Truth)
| Group Name | Group ID | Flow Assigned | Content |
| :--- | :--- | :--- | :--- |
| **NowMensHealth.Care** | `75522` | **Master Flow** | *Default* + Men's Intake + Policies |
| **Weight Loss** | `75976` | **Master Flow** | *Default* + Weight Loss Agmt + History |
| **NowPrimary.Care** | `75523` | **Default** | HIPAA, Consent, AI, Medical History |
| **Pelleting Client** | `75977` | **Default** | HIPAA, Consent, AI, Medical History |

> [!WARNING]
