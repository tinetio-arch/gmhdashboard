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
    return name.trim().toLowerCase().replace(/[^a-z]/g, '');
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
function executeSafeMerge() {
    return __awaiter(this, void 0, void 0, function () {
        var patients, duplicateGroups, processed, i, p1, group, j, p2, emailMap, _i, patients_1, p, email, safeToMergeGroups, checkedGroups, _a, duplicateGroups_1, group, _b, group_1, patient, _c, user, metadata, richness, score, createdTime, e_1, activeCount, hasGroupedPatient, archived, skipped, log, _loop_1, i, report;
        var _d, _e, _f, _g, _h;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0:
                    console.log('🚀 EXECUTING Safe Duplicate Merge');
                    console.log('Fetching ungrouped active duplicates from Snowflake...\n');
                    return [4 /*yield*/, (0, snowflakeClient_1.executeSnowflakeQuery)("\n        SELECT \n            HEALTHIE_ID, FIRST_NAME, LAST_NAME, EMAIL,\n            TO_CHAR(DOB, 'YYYY-MM-DD') as DOB, CREATED_AT\n        FROM GMH_CLINIC.PATIENT_DATA.HEALTHIE_PATIENTS\n        WHERE HEALTHIE_ID IS NOT NULL\n        ORDER BY LAST_NAME, FIRST_NAME\n    ")];
                case 1:
                    patients = _j.sent();
                    console.log("\u2705 Loaded ".concat(patients.length, " patients\n"));
                    duplicateGroups = [];
                    processed = new Set();
                    // Find duplicates (same logic as before)
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
                    emailMap = new Map();
                    for (_i = 0, patients_1 = patients; _i < patients_1.length; _i++) {
                        p = patients_1[_i];
                        email = normalizeEmail(p.EMAIL);
                        if (!email || email.includes('@gethealthie.com'))
                            continue;
                        if (!emailMap.has(email))
                            emailMap.set(email, []);
                        emailMap.get(email).push(p);
                    }
                    Array.from(emailMap.entries()).forEach(function (_a) {
                        var email = _a[0], group = _a[1];
                        if (group.length > 1) {
                            var alreadyGrouped = duplicateGroups.some(function (dg) {
                                return dg.some(function (p) { return group.some(function (gp) { return gp.HEALTHIE_ID === p.HEALTHIE_ID; }); });
                            });
                            if (!alreadyGrouped) {
                                duplicateGroups.push(group);
                            }
                        }
                    });
                    console.log("Found ".concat(duplicateGroups.length, " potential duplicate clusters\n"));
                    console.log('🔍 Enriching with: Active, Group, Stripe, Data Richness...\n');
                    safeToMergeGroups = [];
                    checkedGroups = 0;
                    _a = 0, duplicateGroups_1 = duplicateGroups;
                    _j.label = 2;
                case 2:
                    if (!(_a < duplicateGroups_1.length)) return [3 /*break*/, 10];
                    group = duplicateGroups_1[_a];
                    checkedGroups++;
                    if (checkedGroups % 50 === 0) {
                        console.log("   Enriched ".concat(checkedGroups, "/").concat(duplicateGroups.length, "..."));
                    }
                    _b = 0, group_1 = group;
                    _j.label = 3;
                case 3:
                    if (!(_b < group_1.length)) return [3 /*break*/, 8];
                    patient = group_1[_b];
                    _j.label = 4;
                case 4:
                    _j.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, Promise.all([
                            healthie.getClient(patient.HEALTHIE_ID),
                            healthie.getUserMetadata(patient.HEALTHIE_ID),
                            healthie.getPatientDataRichness(patient.HEALTHIE_ID)
                        ])];
                case 5:
                    _c = _j.sent(), user = _c[0], metadata = _c[1], richness = _c[2];
                    patient.isActive = (_d = user === null || user === void 0 ? void 0 : user.active) !== null && _d !== void 0 ? _d : false;
                    patient.hasGroup = !!(user === null || user === void 0 ? void 0 : user.user_group_id);
                    patient.stripeId = metadata['stripe_customer_id'] || metadata['stripe_id'];
                    patient.dataRichness = richness;
                    score = 0;
                    if (patient.stripeId)
                        score += 10000;
                    if (patient.isActive)
                        score += 1000;
                    score += richness.score; // Documents * 10 + Forms * 5 + etc
                    createdTime = new Date(patient.CREATED_AT).getTime();
                    score += (Number.MAX_SAFE_INTEGER - createdTime) / 100000000000;
                    patient.finalScore = score;
                    return [3 /*break*/, 7];
                case 6:
                    e_1 = _j.sent();
                    console.error("   Error enriching ".concat(patient.HEALTHIE_ID, ":"), e_1.message);
                    patient.isActive = false;
                    patient.hasGroup = false;
                    patient.finalScore = 0;
                    return [3 /*break*/, 7];
                case 7:
                    _b++;
                    return [3 /*break*/, 3];
                case 8:
                    activeCount = group.filter(function (p) { return p.isActive; }).length;
                    hasGroupedPatient = group.some(function (p) { return p.hasGroup; });
                    if (activeCount >= 2 && !hasGroupedPatient) {
                        safeToMergeGroups.push(group);
                    }
                    _j.label = 9;
                case 9:
                    _a++;
                    return [3 /*break*/, 2];
                case 10:
                    console.log("\n\u2705 Found ".concat(safeToMergeGroups.length, " safe clusters to process\n"));
                    console.log('='.repeat(80));
                    console.log('🔥 BEGINNING MERGE EXECUTION');
                    console.log('='.repeat(80));
                    archived = 0;
                    skipped = 0;
                    log = [];
                    _loop_1 = function (i) {
                        var group, master, duplicates, _k, duplicates_1, dup, e_2;
                        return __generator(this, function (_l) {
                            switch (_l.label) {
                                case 0:
                                    group = safeToMergeGroups[i];
                                    // Sort by finalScore descending (master first)
                                    group.sort(function (a, b) { var _a, _b; return ((_a = b.finalScore) !== null && _a !== void 0 ? _a : 0) - ((_b = a.finalScore) !== null && _b !== void 0 ? _b : 0); });
                                    master = group[0];
                                    duplicates = group.filter(function (p) { return p.HEALTHIE_ID !== master.HEALTHIE_ID && p.isActive; });
                                    console.log("\n[".concat(i + 1, "/").concat(safeToMergeGroups.length, "] ").concat(master.FIRST_NAME, " ").concat(master.LAST_NAME));
                                    console.log("  \uD83D\uDC51 MASTER: ".concat(master.HEALTHIE_ID));
                                    console.log("     Stripe: ".concat(master.stripeId || 'None', " | Docs: ").concat(((_e = master.dataRichness) === null || _e === void 0 ? void 0 : _e.details.documents) || 0, " | Forms: ").concat(((_f = master.dataRichness) === null || _f === void 0 ? void 0 : _f.details.forms) || 0));
                                    log.push("\n## Cluster ".concat(i + 1, ": ").concat(master.FIRST_NAME, " ").concat(master.LAST_NAME));
                                    log.push("- **Master:** `".concat(master.HEALTHIE_ID, "` (Stripe: ").concat(master.stripeId || 'None', ", Docs: ").concat(((_g = master.dataRichness) === null || _g === void 0 ? void 0 : _g.details.documents) || 0, ")"));
                                    _k = 0, duplicates_1 = duplicates;
                                    _l.label = 1;
                                case 1:
                                    if (!(_k < duplicates_1.length)) return [3 /*break*/, 6];
                                    dup = duplicates_1[_k];
                                    console.log("  \uD83D\uDDD1\uFE0F  DUPLICATE: ".concat(dup.HEALTHIE_ID));
                                    console.log("     Stripe: ".concat(dup.stripeId || 'None', " | Docs: ").concat(((_h = dup.dataRichness) === null || _h === void 0 ? void 0 : _h.details.documents) || 0));
                                    if (dup.stripeId) {
                                        console.log("     \u26A0\uFE0F SKIPPING: Has Stripe ID!");
                                        log.push("- **Skipped:** `".concat(dup.HEALTHIE_ID, "` (Has Stripe: ").concat(dup.stripeId, ")"));
                                        skipped++;
                                        return [3 /*break*/, 5];
                                    }
                                    _l.label = 2;
                                case 2:
                                    _l.trys.push([2, 4, , 5]);
                                    return [4 /*yield*/, healthie.updateClient(dup.HEALTHIE_ID, { active: false })];
                                case 3:
                                    _l.sent();
                                    console.log("     \u2705 ARCHIVED");
                                    log.push("- **Archived:** `".concat(dup.HEALTHIE_ID, "`"));
                                    archived++;
                                    return [3 /*break*/, 5];
                                case 4:
                                    e_2 = _l.sent();
                                    console.log("     \u274C FAILED: ".concat(e_2.message));
                                    log.push("- **Failed:** `".concat(dup.HEALTHIE_ID, "` - ").concat(e_2.message));
                                    return [3 /*break*/, 5];
                                case 5:
                                    _k++;
                                    return [3 /*break*/, 1];
                                case 6: return [2 /*return*/];
                            }
                        });
                    };
                    i = 0;
                    _j.label = 11;
                case 11:
                    if (!(i < safeToMergeGroups.length)) return [3 /*break*/, 14];
                    return [5 /*yield**/, _loop_1(i)];
                case 12:
                    _j.sent();
                    _j.label = 13;
                case 13:
                    i++;
                    return [3 /*break*/, 11];
                case 14:
                    console.log('\n' + '='.repeat(80));
                    console.log('✅ MERGE COMPLETE');
                    console.log('='.repeat(80));
                    console.log("Clusters Processed: ".concat(safeToMergeGroups.length));
                    console.log("Records Archived: ".concat(archived));
                    console.log("Records Skipped (Stripe): ".concat(skipped));
                    report = "# Merge Execution Log\n\n**Date:** ".concat(new Date().toISOString(), "\n**Clusters:** ").concat(safeToMergeGroups.length, "\n**Archived:** ").concat(archived, "\n**Skipped:** ").concat(skipped, "\n\n---\n\n").concat(log.join('\n'));
                    fs.writeFileSync('merge_execution_log.md', report);
                    console.log('\n📄 Log saved: merge_execution_log.md\n');
                    return [2 /*return*/];
            }
        });
    });
}
executeSafeMerge().catch(console.error);
