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
function analyze() {
    return __awaiter(this, void 0, void 0, function () {
        var patients, clusters, duplicateClusters, enrichedClusters, processed, _i, duplicateClusters_1, cluster, enrichedGroup, _a, _b, p, metadata, stripeId, client, e_1, reportLines, _c, enrichedClusters_1, cluster, sorted, _d, sorted_1, p, flags, flagStr;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    console.log('🔍 Starting Patient Deduplication Analysis...');
                    // 1. Fetch all patients from Snowflake
                    console.log('Fetching patients from Snowflake...');
                    return [4 /*yield*/, (0, snowflakeClient_1.executeSnowflakeQuery)("\n        SELECT \n            HEALTHIE_ID, FIRST_NAME, LAST_NAME, EMAIL, TO_CHAR(DOB, 'YYYY-MM-DD') as DOB, CREATED_AT\n        FROM GMH_CLINIC.PATIENT_DATA.HEALTHIE_PATIENTS\n        WHERE HEALTHIE_ID IS NOT NULL\n    ")];
                case 1:
                    patients = _e.sent();
                    console.log("Found ".concat(patients.length, " total patients."));
                    clusters = new Map();
                    patients.forEach(function (p) {
                        var _a;
                        if (!p.FIRST_NAME || !p.LAST_NAME)
                            return;
                        // Key: Normalized Name + DOB (if available)
                        // We use strict matching first
                        var key = "".concat(p.FIRST_NAME.trim().toLowerCase(), "|").concat(p.LAST_NAME.trim().toLowerCase(), "|").concat(p.DOB || 'NO_DOB');
                        if (!clusters.has(key))
                            clusters.set(key, []);
                        (_a = clusters.get(key)) === null || _a === void 0 ? void 0 : _a.push(p);
                    });
                    duplicateClusters = [];
                    clusters.forEach(function (group, key) {
                        if (group.length > 1) {
                            duplicateClusters.push({ key: key, patients: group });
                        }
                    });
                    console.log("\u26A0\uFE0F Found ".concat(duplicateClusters.length, " duplicate clusters (sharing Name + DOB)."));
                    enrichedClusters = [];
                    console.log('Checking Healthie for Stripe/Group constraints...');
                    processed = 0;
                    _i = 0, duplicateClusters_1 = duplicateClusters;
                    _e.label = 2;
                case 2:
                    if (!(_i < duplicateClusters_1.length)) return [3 /*break*/, 11];
                    cluster = duplicateClusters_1[_i];
                    processed++;
                    if (processed % 10 === 0)
                        console.log("Processed ".concat(processed, "/").concat(duplicateClusters.length, " clusters..."));
                    enrichedGroup = [];
                    _a = 0, _b = cluster.patients;
                    _e.label = 3;
                case 3:
                    if (!(_a < _b.length)) return [3 /*break*/, 9];
                    p = _b[_a];
                    _e.label = 4;
                case 4:
                    _e.trys.push([4, 7, , 8]);
                    return [4 /*yield*/, healthie.getUserMetadata(p.HEALTHIE_ID)];
                case 5:
                    metadata = _e.sent();
                    stripeId = metadata['stripe_customer_id'] || metadata['stripe_id'];
                    return [4 /*yield*/, healthie.getClient(p.HEALTHIE_ID)];
                case 6:
                    client = _e.sent();
                    // Note: Healthie API client definition in lib might need extending if we need full group list
                    // For now, checks single group or if we can infer from metadata
                    enrichedGroup.push(__assign(__assign({}, p), { stripeId: stripeId || undefined, groupNames: [], isSafeToMerge: !stripeId }));
                    return [3 /*break*/, 8];
                case 7:
                    e_1 = _e.sent();
                    console.error("Failed to fetch Healthie data for ".concat(p.HEALTHIE_ID, ":"), e_1);
                    enrichedGroup.push(__assign(__assign({}, p), { isSafeToMerge: false })); // Assume unsafe if error
                    return [3 /*break*/, 8];
                case 8:
                    _a++;
                    return [3 /*break*/, 3];
                case 9:
                    enrichedClusters.push({ key: cluster.key, patients: enrichedGroup });
                    _e.label = 10;
                case 10:
                    _i++;
                    return [3 /*break*/, 2];
                case 11:
                    reportLines = [];
                    reportLines.push('# Patient Deduplication Analysis Report');
                    reportLines.push("Generated: ".concat(new Date().toISOString()));
                    reportLines.push("Total Clusters Found: ".concat(duplicateClusters.length));
                    reportLines.push('');
                    for (_c = 0, enrichedClusters_1 = enrichedClusters; _c < enrichedClusters_1.length; _c++) {
                        cluster = enrichedClusters_1[_c];
                        reportLines.push("## Cluster: ".concat(cluster.key.replace(/\|/g, ' ')));
                        sorted = cluster.patients.sort(function (a, b) { return new Date(a.CREATED_AT).getTime() - new Date(b.CREATED_AT).getTime(); });
                        for (_d = 0, sorted_1 = sorted; _d < sorted_1.length; _d++) {
                            p = sorted_1[_d];
                            flags = [];
                            if (p.stripeId)
                                flags.push("\uD83D\uDCB3 STRIPE (".concat(p.stripeId, ")"));
                            flagStr = flags.length ? "[".concat(flags.join(', '), "]") : '[SAFE]';
                            reportLines.push("- ".concat(p.HEALTHIE_ID, " | ").concat(p.EMAIL, " | Created: ").concat(p.CREATED_AT, " | ").concat(flagStr));
                        }
                        reportLines.push('');
                    }
                    fs.writeFileSync('duplicate_report.md', reportLines.join('\n'));
                    console.log('✅ Analysis complete! Report saved to duplicate_report.md');
                    return [2 /*return*/];
            }
        });
    });
}
analyze().catch(console.error);
