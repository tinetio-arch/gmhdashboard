"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
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
var HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
if (!HEALTHIE_API_KEY) {
    console.error('HEALTHIE_API_KEY not found');
    process.exit(1);
}
var healthie = new healthie_1.HealthieClient({ apiKey: HEALTHIE_API_KEY });
var IS_DRY_RUN = !process.argv.includes('--execute');
var SLEEP_MS = 500; // Sleep between api calls to avoid rate limits
var sleep = function (ms) { return new Promise(function (resolve) { return setTimeout(resolve, ms); }); };
function executeMerge() {
    return __awaiter(this, void 0, void 0, function () {
        var patients, clusters, duplicateClusters, mergedCount, skippedCount, alreadyInactiveCount, processed, _i, duplicateClusters_1, group, enriched, _a, group_1, p, user, metadata, dataRichness, stripeId, score, createdTime, e_1, master, duplicates, hasStripe, hasActiveConflict, _b, duplicates_1, dup, e_2;
        var _c, _d, _e, _f, _g, _h, _j;
        return __generator(this, function (_k) {
            switch (_k.label) {
                case 0:
                    console.log("\uD83D\uDE80 Starting Smart Merge Process (".concat(IS_DRY_RUN ? 'DRY RUN' : 'EXECUTION MODE', ")..."));
                    console.log('📊 Using data richness scoring (documents priority)\n');
                    // 1. Fetch Candidates
                    console.log('Fetching patients...');
                    return [4 /*yield*/, (0, snowflakeClient_1.executeSnowflakeQuery)("\n        SELECT \n            HEALTHIE_ID, FIRST_NAME, LAST_NAME, EMAIL, TO_CHAR(DOB, 'YYYY-MM-DD') as DOB, CREATED_AT\n        FROM GMH_CLINIC.PATIENT_DATA.HEALTHIE_PATIENTS\n        WHERE HEALTHIE_ID IS NOT NULL\n    ")];
                case 1:
                    patients = _k.sent();
                    clusters = new Map();
                    patients.forEach(function (p) {
                        var _a;
                        if (!p.FIRST_NAME || !p.LAST_NAME)
                            return;
                        var key = "".concat(p.FIRST_NAME.trim().toLowerCase(), "|").concat(p.LAST_NAME.trim().toLowerCase(), "|").concat(p.DOB || 'NO_DOB');
                        if (!clusters.has(key))
                            clusters.set(key, []);
                        (_a = clusters.get(key)) === null || _a === void 0 ? void 0 : _a.push(p);
                    });
                    duplicateClusters = Array.from(clusters.values()).filter(function (g) { return g.length > 1; });
                    console.log("Found ".concat(duplicateClusters.length, " clusters to process.\n"));
                    mergedCount = 0;
                    skippedCount = 0;
                    alreadyInactiveCount = 0;
                    processed = 0;
                    _i = 0, duplicateClusters_1 = duplicateClusters;
                    _k.label = 2;
                case 2:
                    if (!(_i < duplicateClusters_1.length)) return [3 /*break*/, 21];
                    group = duplicateClusters_1[_i];
                    processed++;
                    if (!(processed % 10 === 0)) return [3 /*break*/, 4];
                    process.stdout.write('.');
                    return [4 /*yield*/, sleep(1000)];
                case 3:
                    _k.sent(); // Backoff every 10 items
                    _k.label = 4;
                case 4:
                    enriched = [];
                    _a = 0, group_1 = group;
                    _k.label = 5;
                case 5:
                    if (!(_a < group_1.length)) return [3 /*break*/, 13];
                    p = group_1[_a];
                    _k.label = 6;
                case 6:
                    _k.trys.push([6, 11, , 12]);
                    return [4 /*yield*/, healthie.getClient(p.HEALTHIE_ID)];
                case 7:
                    user = _k.sent();
                    return [4 /*yield*/, healthie.getUserMetadata(p.HEALTHIE_ID)];
                case 8:
                    metadata = _k.sent();
                    return [4 /*yield*/, healthie.getPatientDataRichness(p.HEALTHIE_ID)];
                case 9:
                    dataRichness = _k.sent();
                    stripeId = metadata['stripe_customer_id'] || metadata['stripe_id'];
                    score = 0;
                    // Priority Rules:
                    // 1. Stripe ID (+1000)
                    // 2. Active Status (+800) - Prefer keeping active ones
                    // 3. Group Membership (+500)
                    // 4. Data Richness (+variable, PRIMARY per user request)
                    // 5. Age (+fraction)
                    if (stripeId)
                        score += 1000;
                    if (user.active)
                        score += 800;
                    if (user.user_group_id)
                        score += 500;
                    score += dataRichness.score; // Documents * 10 + Forms * 5 + etc
                    createdTime = new Date(p.CREATED_AT).getTime();
                    score += (Number.MAX_SAFE_INTEGER - createdTime) / 100000000000;
                    enriched.push(__assign(__assign({}, p), { stripeId: stripeId, userGroupId: user.user_group_id, isActive: user.active, dataRichness: dataRichness, score: score }));
                    return [4 /*yield*/, sleep(SLEEP_MS)];
                case 10:
                    _k.sent(); // Rate limit per patient fetch
                    return [3 /*break*/, 12];
                case 11:
                    e_1 = _k.sent();
                    console.error("Error fetching ".concat(p.HEALTHIE_ID), e_1);
                    return [3 /*break*/, 12];
                case 12:
                    _a++;
                    return [3 /*break*/, 5];
                case 13:
                    if (enriched.length < 2)
                        return [3 /*break*/, 20];
                    // Sort by score descending (Master first)
                    enriched.sort(function (a, b) { return b.score - a.score; });
                    master = enriched[0];
                    duplicates = enriched.slice(1);
                    hasStripe = enriched.some(function (p) { return p.stripeId; });
                    hasActiveConflict = duplicates.some(function (d) { return d.isActive; });
                    // Always log if there's an action to take or conflict
                    if (hasStripe || hasActiveConflict) {
                        console.log("\n".concat('='.repeat(60)));
                        console.log("Cluster: ".concat(master.FIRST_NAME, " ").concat(master.LAST_NAME));
                        console.log("  \uD83D\uDC51 MASTER: ".concat(master.HEALTHIE_ID));
                        console.log("     Active: ".concat(master.isActive, " | Group: ").concat(master.userGroupId || 'None', " | Stripe: ").concat(master.stripeId || 'No'));
                        console.log("     \uD83D\uDCCA Data: ".concat(((_c = master.dataRichness) === null || _c === void 0 ? void 0 : _c.details.documents) || 0, " docs, ").concat(((_d = master.dataRichness) === null || _d === void 0 ? void 0 : _d.details.forms) || 0, " forms, ").concat(((_e = master.dataRichness) === null || _e === void 0 ? void 0 : _e.details.medications) || 0, " meds"));
                        console.log("     Score: ".concat(master.score.toFixed(2)));
                    }
                    _b = 0, duplicates_1 = duplicates;
                    _k.label = 14;
                case 14:
                    if (!(_b < duplicates_1.length)) return [3 /*break*/, 20];
                    dup = duplicates_1[_b];
                    if (hasStripe || hasActiveConflict) {
                        console.log("  \uD83D\uDDD1\uFE0F  DUPLICATE: ".concat(dup.HEALTHIE_ID));
                        console.log("     Active: ".concat(dup.isActive, " | Group: ").concat(dup.userGroupId || 'None', " | Stripe: ").concat(dup.stripeId || 'No'));
                        console.log("     \uD83D\uDCCA Data: ".concat(((_f = dup.dataRichness) === null || _f === void 0 ? void 0 : _f.details.documents) || 0, " docs, ").concat(((_g = dup.dataRichness) === null || _g === void 0 ? void 0 : _g.details.forms) || 0, " forms, ").concat(((_h = dup.dataRichness) === null || _h === void 0 ? void 0 : _h.details.medications) || 0, " meds"));
                        console.log("     Score: ".concat(dup.score.toFixed(2)));
                    }
                    if (dup.stripeId) {
                        console.log("  \u26A0\uFE0F SKIPPING: Duplicate has Stripe ID!");
                        skippedCount++;
                        return [3 /*break*/, 19];
                    }
                    if (!dup.isActive) {
                        // Already inactive - no action needed
                        alreadyInactiveCount++;
                        return [3 /*break*/, 19];
                    }
                    if (!IS_DRY_RUN) return [3 /*break*/, 15];
                    console.log("  \u2705 [DRY RUN] Would archive ".concat(dup.HEALTHIE_ID, " (keeping ").concat(((_j = dup.dataRichness) === null || _j === void 0 ? void 0 : _j.details.documents) || 0, " docs with inactive record)"));
                    return [3 /*break*/, 19];
                case 15:
                    _k.trys.push([15, 18, , 19]);
                    return [4 /*yield*/, healthie.updateClient(dup.HEALTHIE_ID, { active: false })];
                case 16:
                    _k.sent();
                    console.log("  \u2705 Archived ".concat(dup.HEALTHIE_ID));
                    mergedCount++;
                    return [4 /*yield*/, sleep(SLEEP_MS)];
                case 17:
                    _k.sent();
                    return [3 /*break*/, 19];
                case 18:
                    e_2 = _k.sent();
                    console.error("  \u274C Failed to archive ".concat(dup.HEALTHIE_ID), e_2);
                    return [3 /*break*/, 19];
                case 19:
                    _b++;
                    return [3 /*break*/, 14];
                case 20:
                    _i++;
                    return [3 /*break*/, 2];
                case 21:
                    console.log("\n".concat('='.repeat(60)));
                    console.log("Process Complete.");
                    console.log("Would Archive (Active Duplicates): ".concat(IS_DRY_RUN ? mergedCount : 'N/A'));
                    console.log("Actually Archived: ".concat(!IS_DRY_RUN ? mergedCount : 'N/A'));
                    console.log("Already Inactive (No Action): ".concat(alreadyInactiveCount));
                    console.log("Skipped (Stripe/Safety): ".concat(skippedCount));
                    console.log("".concat('='.repeat(60)));
                    return [2 /*return*/];
            }
        });
    });
}
executeMerge().catch(console.error);
