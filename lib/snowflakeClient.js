"use strict";
/**
 * Shared Snowflake Client with Key-Pair Authentication
 * Uses JARVIS_SERVICE_ACCOUNT service account to bypass MFA requirement
 */
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testSnowflakeConnection = exports.executeSnowflakeQuery = exports.querySnowflake = exports.connectSnowflake = exports.createSnowflakeConnection = void 0;
var snowflake_sdk_1 = __importDefault(require("snowflake-sdk"));
var fs = __importStar(require("fs"));
// Configuration from environment
var _a = process.env, _b = _a.SNOWFLAKE_ACCOUNT, SNOWFLAKE_ACCOUNT = _b === void 0 ? 'KXWWLYZ-DZ83651' : _b, _c = _a.SNOWFLAKE_SERVICE_USER, SNOWFLAKE_SERVICE_USER = _c === void 0 ? 'JARVIS_SERVICE_ACCOUNT' : _c, _d = _a.SNOWFLAKE_PRIVATE_KEY_PATH, SNOWFLAKE_PRIVATE_KEY_PATH = _d === void 0 ? '/home/ec2-user/.snowflake/rsa_key_new.p8' : _d, _e = _a.SNOWFLAKE_WAREHOUSE, SNOWFLAKE_WAREHOUSE = _e === void 0 ? 'GMH_WAREHOUSE' : _e, _f = _a.SNOWFLAKE_DATABASE, SNOWFLAKE_DATABASE = _f === void 0 ? 'GMH_CLINIC' : _f, _g = _a.SNOWFLAKE_SCHEMA, SNOWFLAKE_SCHEMA = _g === void 0 ? 'PATIENT_DATA' : _g;
// Cache the private key
var privateKey = null;
function getPrivateKey() {
    if (privateKey)
        return privateKey;
    try {
        // Read the unencrypted private key
        var keyPath = SNOWFLAKE_PRIVATE_KEY_PATH;
        var keyContent = fs.readFileSync(keyPath, 'utf8');
        // The key should be in PEM format without password
        privateKey = keyContent;
        return privateKey;
    }
    catch (error) {
        console.error('Failed to read Snowflake private key:', error);
        throw new Error("Could not load Snowflake private key from ".concat(SNOWFLAKE_PRIVATE_KEY_PATH));
    }
}
/**
 * Create a Snowflake connection using key-pair authentication
 */
function createSnowflakeConnection(config) {
    var key = getPrivateKey();
    return snowflake_sdk_1.default.createConnection({
        account: SNOWFLAKE_ACCOUNT,
        username: SNOWFLAKE_SERVICE_USER,
        authenticator: 'SNOWFLAKE_JWT',
        privateKey: key,
        warehouse: (config === null || config === void 0 ? void 0 : config.warehouse) || SNOWFLAKE_WAREHOUSE,
        database: (config === null || config === void 0 ? void 0 : config.database) || SNOWFLAKE_DATABASE,
        schema: (config === null || config === void 0 ? void 0 : config.schema) || SNOWFLAKE_SCHEMA,
    });
}
exports.createSnowflakeConnection = createSnowflakeConnection;
/**
 * Connect to Snowflake (promisified)
 */
function connectSnowflake(conn) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    conn.connect(function (err) {
                        if (err) {
                            console.error('Snowflake connection error:', err.message);
                            reject(err);
                        }
                        else {
                            resolve();
                        }
                    });
                })];
        });
    });
}
exports.connectSnowflake = connectSnowflake;
/**
 * Execute a query (promisified)
 */
function querySnowflake(conn, sql) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    conn.execute({
                        sqlText: sql,
                        complete: function (err, stmt, rows) {
                            if (err) {
                                console.error('Snowflake query error:', err.message);
                                reject(err);
                            }
                            else {
                                resolve((rows || []));
                            }
                        },
                    });
                })];
        });
    });
}
exports.querySnowflake = querySnowflake;
/**
 * Execute a query with auto-connect and cleanup
 * This is the main function to use for one-off queries
 */
function executeSnowflakeQuery(sql, config) {
    return __awaiter(this, void 0, void 0, function () {
        var conn, results;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    conn = createSnowflakeConnection(config);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, , 4, 5]);
                    return [4 /*yield*/, connectSnowflake(conn)];
                case 2:
                    _a.sent();
                    return [4 /*yield*/, querySnowflake(conn, sql)];
                case 3:
                    results = _a.sent();
                    return [2 /*return*/, results];
                case 4:
                    conn.destroy(function () { });
                    return [7 /*endfinally*/];
                case 5: return [2 /*return*/];
            }
        });
    });
}
exports.executeSnowflakeQuery = executeSnowflakeQuery;
/**
 * Test Snowflake connectivity (returns true if connection is successful)
 */
function testSnowflakeConnection() {
    return __awaiter(this, void 0, void 0, function () {
        var start, error_1, errorMessage;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    start = Date.now();
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, executeSnowflakeQuery('SELECT 1 AS test')];
                case 2:
                    _a.sent();
                    return [2 /*return*/, {
                            connected: true,
                            responseTime: Date.now() - start,
                        }];
                case 3:
                    error_1 = _a.sent();
                    errorMessage = error_1 instanceof Error ? error_1.message : 'Unknown error';
                    return [2 /*return*/, {
                            connected: false,
                            responseTime: Date.now() - start,
                            error: errorMessage,
                        }];
                case 4: return [2 /*return*/];
            }
        });
    });
}
exports.testSnowflakeConnection = testSnowflakeConnection;
