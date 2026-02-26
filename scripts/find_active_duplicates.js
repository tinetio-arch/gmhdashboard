"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var dotenv_1 = require("dotenv");
(0, dotenv_1.config)({ path: '.env.local' });
var snowflakeClient_1 = require("../lib/snowflakeClient");
var healthie_1 = require("../lib/healthie");
var fs = __importStar(require("fs"));
var HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
if (!HEALTHIE_API_KEY) {
    console.error('HEALTHIE_API_KEY not found');
    process.exit(1);
}
var healthie = new healthie_1.HealthieClient({ apiKey: HEALTHIE_API_KEY });
function normalizeEmail(email) {
    if (!email)
        return '';
    return email.trim().toLowerCase();
}
function normalizeName(name) {
    if (!name)
        return '';
    return name.trim().toLowerCase()
        .replace(/[^a-z]/g, ''); // Remove non-letters for fuzzy matching
}
function levenshteinDistance(str1, str2) {
    var matrix = [];
    for (var i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    for (var j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    for (var i = 1; i <= str2.length; i++) {
        for (var j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            }
            else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
            }
        }
    }
    return matrix[str2.length][str1.length];
}
function areSimilarNames(name1, name2) {
    if (!name1 || !name2)
        return false;
    var n1 = normalizeName(name1);
    var n2 = normalizeName(name2);
    if (n1 === n2)
        return true;
    if (n1.includes(n2) || n2.includes(n1))
        return true;
    if (levenshteinDistance(n1, n2) < 3 && Math.min(n1.length, n2.length) > 3)
        return true;
    return false;
}
function findActiveDuplicates() {
    return __awaiter(this, void 0, void 0, function () {
        var patients, duplicateGroups, processed, i, p1, group, j, p2, emailMap, _i, patients_1, p, email, emailDupes, activeDuplicateGroups, checkedGroups, _a, duplicateGroups_1, group, _b, group_1, patient, user, e_1, activeCount, totalActiveRecords, totalToArchive, report, i, group, activeInGroup, _c, group_2, p, statusIcon;
        var _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    console.log('🔍 Finding ACTIVE Duplicates Only (NO RATE LIMITING)');
                    console.log('Fetching ALL patients from Snowflake...\n');
                    return [4 /*yield*/, (0, snowflakeClient_1.executeSnowflakeQuery)("\n        SELECT \n            HEALTHIE_ID,\n            FIRST_NAME,\n            LAST_NAME,\n            EMAIL,\n            TO_CHAR(DOB, 'YYYY-MM-DD') as DOB,\n            CREATED_AT\n        FROM GMH_CLINIC.PATIENT_DATA.HEALTHIE_PATIENTS\n        WHERE HEALTHIE_ID IS NOT NULL\n        ORDER BY LAST_NAME, FIRST_NAME\n    ")];
                case 1:
                    patients = _e.sent();
                    console.log("\u2705 Loaded ".concat(patients.length, " patients\n"));
                    console.log('Finding potential duplicates...\n');
                    duplicateGroups = [];
                    processed = new Set();
                    // Strategy 1: Same Last Name + DOB + Similar First Name
                    console.log('📋 Strategy 1: Same Last Name + DOB + Similar First Name');
                    for (i = 0; i < patients.length; i++) {
                        if (processed.has(i))
                            continue;
                        p1 = patients[i];
                        if (!p1.LAST_NAME || !p1.DOB)
                            continue;
                        group = [p1];
                        for (j = i + 1; j < patients.length; j++) {
                            if (processed.has(j))
                                continue;
                            p2 = patients[j];
                            if (!p2.LAST_NAME || !p2.DOB)
                                continue;
                            if (normalizeName(p1.LAST_NAME) !== normalizeName(p2.LAST_NAME))
                                continue;
                            if (p1.DOB !== p2.DOB)
                                continue;
                            if (areSimilarNames(p1.FIRST_NAME, p2.FIRST_NAME)) {
                                group.push(p2);
                                processed.add(j);
                            }
                        }
                        if (group.length > 1) {
                            duplicateGroups.push(group);
                            processed.add(i);
                        }
                    }
                    console.log("   Found ".concat(duplicateGroups.length, " groups\n"));
                    // Strategy 2: Same Email
                    console.log('📧 Strategy 2: Same Email Address');
                    emailMap = new Map();
                    for (_i = 0, patients_1 = patients; _i < patients_1.length; _i++) {
                        p = patients_1[_i];
                        email = normalizeEmail(p.EMAIL);
                        if (!email || email.includes('@gethealthie.com'))
                            continue;
                        if (!emailMap.has(email)) {
                            emailMap.set(email, []);
                        }
                        emailMap.get(email).push(p);
                    }
                    emailDupes = 0;
                    Array.from(emailMap.entries()).forEach(function (_a) {
                        var email = _a[0], group = _a[1];
                        if (group.length > 1) {
                            var alreadyGrouped = duplicateGroups.some(function (dg) {
                                return dg.some(function (p) { return group.some(function (gp) { return gp.HEALTHIE_ID === p.HEALTHIE_ID; }); });
                            });
                            if (!alreadyGrouped) {
                                duplicateGroups.push(group);
                                emailDupes++;
                            }
                        }
                    });
                    console.log("   Found ".concat(emailDupes, " additional groups by email\n"));
                    console.log("Total potential duplicate groups: ".concat(duplicateGroups.length, "\n"));
                    console.log('🔍 Checking Healthie API for ACTIVE status (this may take a few minutes)...\n');
                    activeDuplicateGroups = [];
                    checkedGroups = 0;
                    _a = 0, duplicateGroups_1 = duplicateGroups;
                    _e.label = 2;
                case 2:
                    if (!(_a < duplicateGroups_1.length)) return [3 /*break*/, 10];
                    group = duplicateGroups_1[_a];
                    checkedGroups++;
                    if (checkedGroups % 50 === 0) {
                        console.log("   Checked ".concat(checkedGroups, "/").concat(duplicateGroups.length, " groups..."));
                    }
                    _b = 0, group_1 = group;
                    _e.label = 3;
                case 3:
                    if (!(_b < group_1.length)) return [3 /*break*/, 8];
                    patient = group_1[_b];
                    _e.label = 4;
                case 4:
                    _e.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, healthie.getClient(patient.HEALTHIE_ID)];
                case 5:
                    user = _e.sent();
                    patient.isActive = (_d = user === null || user === void 0 ? void 0 : user.active) !== null && _d !== void 0 ? _d : false;
                    return [3 /*break*/, 7];
                case 6:
                    e_1 = _e.sent();
                    console.error("   Error checking ".concat(patient.HEALTHIE_ID, ":"), e_1.message);
                    patient.isActive = false; // Assume inactive if can't fetch
                    return [3 /*break*/, 7];
                case 7:
                    _b++;
                    return [3 /*break*/, 3];
                case 8:
                    activeCount = group.filter(function (p) { return p.isActive; }).length;
                    // Only include groups with 2+ active patients
                    if (activeCount >= 2) {
                        activeDuplicateGroups.push(group);
                    }
                    _e.label = 9;
                case 9:
                    _a++;
                    return [3 /*break*/, 2];
                case 10:
                    console.log("\n\u2705 Active status check complete!\n");
                    // Generate Report
                    console.log('='.repeat(80));
                    console.log("ACTIONABLE DUPLICATE GROUPS: ".concat(activeDuplicateGroups.length));
                    console.log('='.repeat(80));
                    totalActiveRecords = 0;
                    totalToArchive = 0;
                    report = "# Active Duplicate Detection Report\n\n";
                    report += "**Generated:** ".concat(new Date().toISOString(), "\n");
                    report += "**Total Patients Analyzed:** ".concat(patients.length, "\n");
                    report += "**Potential Duplicate Groups:** ".concat(duplicateGroups.length, "\n");
                    report += "**ACTIONABLE Groups (2+ Active):** ".concat(activeDuplicateGroups.length, "\n\n");
                    report += "> \u26A0\uFE0F This report ONLY shows groups with 2+ ACTIVE patients. Already-resolved duplicates are excluded.\n\n";
                    report += "---\n\n";
                    for (i = 0; i < activeDuplicateGroups.length; i++) {
                        group = activeDuplicateGroups[i];
                        activeInGroup = group.filter(function (p) { return p.isActive; });
                        totalActiveRecords += activeInGroup.length;
                        totalToArchive += activeInGroup.length - 1; // Keep 1, archive rest
                        report += "## Group ".concat(i + 1, ": ").concat(group[0].FIRST_NAME, " ").concat(group[0].LAST_NAME, "\n\n");
                        report += "**Active Count:** ".concat(activeInGroup.length, " \u26A0\uFE0F\n\n");
                        for (_c = 0, group_2 = group; _c < group_2.length; _c++) {
                            p = group_2[_c];
                            statusIcon = p.isActive ? '✅ ACTIVE' : '💤 Inactive';
                            report += "- ".concat(statusIcon, " **ID:** `").concat(p.HEALTHIE_ID, "`\n");
                            report += "  - Email: ".concat(p.EMAIL || 'N/A', "\n");
                            report += "  - DOB: ".concat(p.DOB || 'N/A', "\n");
                            report += "  - Created: ".concat(p.CREATED_AT, "\n");
                            report += "\n";
                        }
                        report += "---\n\n";
                    }
                    report += "\n## Summary\n\n";
                    report += "- **Actionable Groups:** ".concat(activeDuplicateGroups.length, "\n");
                    report += "- **Total Active Duplicates:** ".concat(totalActiveRecords, "\n");
                    report += "- **Records to Archive:** ".concat(totalToArchive, " (keeping 1 per group)\n");
                    fs.writeFileSync('active_duplicates_report.md', report);
                    console.log('\n✅ Report saved to: active_duplicates_report.md');
                    console.log("\n\uD83D\uDCCA ACTIONABLE Summary:");
                    console.log("   - ".concat(activeDuplicateGroups.length, " groups with 2+ active patients"));
                    console.log("   - ".concat(totalActiveRecords, " total active duplicate records"));
                    console.log("   - ".concat(totalToArchive, " records need archiving\n"));
                    return [2 /*return*/];
            }
        });
    });
}
findActiveDuplicates().catch(console.error);
