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
var fs = __importStar(require("fs"));
function normalizePhone(phone) {
    if (!phone)
        return '';
    return phone.replace(/\D/g, '');
}
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
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, // substitution
                matrix[i][j - 1] + 1, // insertion
                matrix[i - 1][j] + 1 // deletion
                );
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
    // Exact match
    if (n1 === n2)
        return true;
    // One is substring of the other (e.g., "Greg" in "Gregory")
    if (n1.includes(n2) || n2.includes(n1))
        return true;
    // Levenshtein distance < 3 (allows for 1-2 typos)
    if (levenshteinDistance(n1, n2) < 3 && Math.min(n1.length, n2.length) > 3)
        return true;
    return false;
}
function findAllDuplicates() {
    return __awaiter(this, void 0, void 0, function () {
        var patients, duplicateGroups, processed, i, p1, group, j, p2, emailMap, _i, patients_1, p, email, emailDupes, totalDuplicateRecords, report, i, group, _a, group_1, p;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    console.log('🔍 COMPREHENSIVE Duplicate Detection (NO RATE LIMITING)');
                    console.log('Fetching ALL patients from Snowflake...\n');
                    return [4 /*yield*/, (0, snowflakeClient_1.executeSnowflakeQuery)("\n        SELECT \n            HEALTHIE_ID,\n            FIRST_NAME,\n            LAST_NAME,\n            EMAIL,\n            TO_CHAR(DOB, 'YYYY-MM-DD') as DOB,\n            CREATED_AT\n        FROM GMH_CLINIC.PATIENT_DATA.HEALTHIE_PATIENTS\n        WHERE HEALTHIE_ID IS NOT NULL\n        ORDER BY LAST_NAME, FIRST_NAME\n    ")];
                case 1:
                    patients = _b.sent();
                    console.log("\u2705 Loaded ".concat(patients.length, " patients\n"));
                    console.log('Finding duplicates by multiple criteria...\n');
                    duplicateGroups = [];
                    processed = new Set();
                    // Strategy 1: Exact Last Name + DOB + Similar First Name
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
                            // Same last name (exact)
                            if (normalizeName(p1.LAST_NAME) !== normalizeName(p2.LAST_NAME))
                                continue;
                            // Same DOB
                            if (p1.DOB !== p2.DOB)
                                continue;
                            // Similar first name (handles Greg/Gregory, typos)
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
                    // Strategy 2: Same Email (non-empty)
                    console.log('📧 Strategy 2: Same Email Address');
                    emailMap = new Map();
                    for (_i = 0, patients_1 = patients; _i < patients_1.length; _i++) {
                        p = patients_1[_i];
                        email = normalizeEmail(p.EMAIL);
                        if (!email || email.includes('@gethealthie.com'))
                            continue; // Skip placeholder emails
                        if (!emailMap.has(email)) {
                            emailMap.set(email, []);
                        }
                        emailMap.get(email).push(p);
                    }
                    emailDupes = 0;
                    Array.from(emailMap.entries()).forEach(function (_a) {
                        var email = _a[0], group = _a[1];
                        if (group.length > 1) {
                            // Check if already found by name
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
                    // Generate Report
                    console.log('='.repeat(80));
                    console.log("TOTAL DUPLICATE GROUPS FOUND: ".concat(duplicateGroups.length));
                    console.log('='.repeat(80));
                    totalDuplicateRecords = 0;
                    report = "# Comprehensive Duplicate Detection Report\n\n";
                    report += "**Generated:** ".concat(new Date().toISOString(), "\n");
                    report += "**Total Patients Analyzed:** ".concat(patients.length, "\n");
                    report += "**Duplicate Groups Found:** ".concat(duplicateGroups.length, "\n\n");
                    report += "---\n\n";
                    for (i = 0; i < duplicateGroups.length; i++) {
                        group = duplicateGroups[i];
                        totalDuplicateRecords += group.length;
                        report += "## Group ".concat(i + 1, ": ").concat(group[0].FIRST_NAME, " ").concat(group[0].LAST_NAME, "\n\n");
                        for (_a = 0, group_1 = group; _a < group_1.length; _a++) {
                            p = group_1[_a];
                            report += "- **ID:** `".concat(p.HEALTHIE_ID, "`\n");
                            report += "  - Email: ".concat(p.EMAIL || 'N/A', "\n");
                            report += "  - DOB: ".concat(p.DOB || 'N/A', "\n");
                            report += "  - Created: ".concat(p.CREATED_AT, "\n");
                            report += "\n";
                        }
                        report += "---\n\n";
                    }
                    report += "\n**Total Duplicate Records:** ".concat(totalDuplicateRecords, "\n");
                    report += "**Records to Archive:** ".concat(totalDuplicateRecords - duplicateGroups.length, " (keeping 1 per group)\n");
                    fs.writeFileSync('comprehensive_duplicates_report.md', report);
                    console.log('\n✅ Report saved to: comprehensive_duplicates_report.md');
                    console.log("\n\uD83D\uDCCA Summary:");
                    console.log("   - ".concat(duplicateGroups.length, " duplicate groups"));
                    console.log("   - ".concat(totalDuplicateRecords, " total duplicate records"));
                    console.log("   - ".concat(totalDuplicateRecords - duplicateGroups.length, " records to archive\n"));
                    return [2 /*return*/];
            }
        });
    });
}
findAllDuplicates().catch(console.error);
