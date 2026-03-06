/**
 * UPS REST API Client
 * 
 * Handles OAuth 2.0 authentication and provides typed wrappers for:
 * - Address Validation
 * - Rating (shipping quotes)
 * - Shipping (label creation)
 * - Tracking
 * - Void (cancel shipment)
 * 
 * Base URL: https://onlinetools.ups.com (production)
 * Auth: OAuth 2.0 client_credentials grant
 * Account: #158V7K
 */

const UPS_BASE_URL = 'https://onlinetools.ups.com';
const UPS_TOKEN_URL = `${UPS_BASE_URL}/security/v1/oauth/token`;

// ─── Types ───────────────────────────────────────────────────────────────────

export type UPSAddress = {
    name: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    countryCode: string;
    phone?: string;
    email?: string;
};

export type UPSPackage = {
    weight: number;        // lbs
    length?: number;       // inches
    width?: number;        // inches
    height?: number;       // inches
    description?: string;
};

export type UPSRateResult = {
    serviceCode: string;
    serviceName: string;
    totalCharges: string;
    currency: string;
    guaranteedDays?: string;
    scheduledDelivery?: string;
    warnings?: string[];
};

export type UPSShipmentResult = {
    trackingNumber: string;
    shipmentIdentificationNumber: string;
    labelImageFormat: string;
    labelImageBase64: string;
    totalCharges: string;
    currency: string;
};

export type UPSTrackingActivity = {
    status: string;
    statusCode: string;
    description: string;
    location: string;
    date: string;
    time: string;
};

export type UPSTrackingResult = {
    trackingNumber: string;
    currentStatus: string;
    statusCode: string;
    estimatedDelivery?: string;
    deliveredDate?: string;
    activities: UPSTrackingActivity[];
};

export type UPSValidationCandidate = {
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    classification: string; // 'commercial' | 'residential' | 'unknown'
    confidence: number;
};

export type UPSValidationResult = {
    valid: boolean;
    candidates: UPSValidationCandidate[];
    ambiguous: boolean;
};

export type UPSError = {
    code: string;
    message: string;
    details?: string;
};

// ─── Token Cache ─────────────────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

/**
 * Get an OAuth 2.0 bearer token from UPS using client_credentials grant.
 * Token is cached in memory until 60s before expiry.
 */
export async function getUPSToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (cachedToken && Date.now() < tokenExpiry - 60_000) {
        return cachedToken;
    }

    const clientId = process.env.UPS_CLIENT_ID;
    const clientSecret = process.env.UPS_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('UPS_CLIENT_ID and UPS_CLIENT_SECRET must be set in environment');
    }

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(UPS_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`UPS OAuth failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    cachedToken = data.access_token;
    // UPS tokens typically last 14400s (4 hours)
    tokenExpiry = Date.now() + (data.expires_in || 14400) * 1000;

    return cachedToken!;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

async function upsRequest(method: string, path: string, body?: object): Promise<any> {
    const token = await getUPSToken();

    const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'transId': `gmh-${Date.now()}`,
        'transactionSrc': 'GMH-Dashboard',
    };

    const response = await fetch(`${UPS_BASE_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    const responseData = await response.json();

    if (!response.ok) {
        const errors = responseData?.response?.errors || responseData?.errors || [];
        const firstError = errors[0] || {};
        throw {
            code: firstError.code || `HTTP_${response.status}`,
            message: firstError.message || `UPS API error (${response.status})`,
            details: JSON.stringify(responseData),
        } as UPSError;
    }

    return responseData;
}

function getShipperInfo() {
    return {
        Name: process.env.UPS_SHIPPER_NAME || 'NOW Mens Health',
        ShipperNumber: process.env.UPS_ACCOUNT_NUMBER || '',
        Phone: { Number: process.env.UPS_SHIPPER_PHONE || '' },
        Address: {
            AddressLine: [process.env.UPS_SHIPPER_ADDRESS_LINE1 || '215 N McCormick'],
            City: process.env.UPS_SHIPPER_CITY || 'Prescott',
            StateProvinceCode: process.env.UPS_SHIPPER_STATE || 'AZ',
            PostalCode: process.env.UPS_SHIPPER_POSTAL || '86301',
            CountryCode: process.env.UPS_SHIPPER_COUNTRY || 'US',
        },
    };
}

// ─── Address Validation ──────────────────────────────────────────────────────

export async function validateAddress(address: {
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    countryCode?: string;
}): Promise<UPSValidationResult> {
    const body = {
        XAVRequest: {
            AddressKeyFormat: {
                AddressLine: [address.addressLine1],
                PoliticalDivision2: address.city,
                PoliticalDivision1: address.state,
                PostcodePrimaryLow: address.postalCode,
                CountryCode: address.countryCode || 'US',
            },
        },
    };

    // UPS Address Validation: /api/addressvalidation/v1/{requestoption}
    // requestoption: 1=validation, 2=classification, 3=both
    // Tested and confirmed: /api/ prefix required, v1 works
    const data = await upsRequest('POST', '/api/addressvalidation/v1/3', body);

    const xavResponse = data.XAVResponse || {};
    const candidateList = xavResponse.Candidate || xavResponse.AddressKeyFormat
        ? [xavResponse.AddressKeyFormat]
        : [];

    const candidates: UPSValidationCandidate[] = (Array.isArray(candidateList) ? candidateList : [candidateList])
        .filter(Boolean)
        .map((c: any) => {
            const addr = c.AddressKeyFormat || c;
            const classCode = c.AddressClassification?.Code || xavResponse.AddressClassification?.Code || '0';
            return {
                addressLine1: Array.isArray(addr.AddressLine) ? addr.AddressLine[0] : (addr.AddressLine || ''),
                city: addr.PoliticalDivision2 || '',
                state: addr.PoliticalDivision1 || '',
                postalCode: `${addr.PostcodePrimaryLow || ''}${addr.PostcodeExtendedLow ? '-' + addr.PostcodeExtendedLow : ''}`,
                classification: classCode === '1' ? 'commercial' : classCode === '2' ? 'residential' : 'unknown',
                confidence: xavResponse.ValidAddressIndicator !== undefined ? 1 : 0.5,
            };
        });

    return {
        valid: xavResponse.ValidAddressIndicator !== undefined,
        candidates,
        ambiguous: xavResponse.AmbiguousAddressIndicator !== undefined,
    };
}

// ─── Rating ──────────────────────────────────────────────────────────────────

/**
 * UPS Service Codes:
 * 01 = Next Day Air
 * 02 = 2nd Day Air
 * 03 = Ground
 * 12 = 3 Day Select
 * 13 = Next Day Air Saver
 * 14 = UPS Next Day Air Early
 * 59 = 2nd Day Air A.M.
 */
export async function getRates(
    shipTo: UPSAddress,
    packages: UPSPackage[],
    serviceCode?: string,
): Promise<UPSRateResult[]> {
    const shipper = getShipperInfo();

    const upsPackages = packages.map((pkg) => {
        const p: any = {
            PackagingType: { Code: '02', Description: 'Customer Supplied Package' },
            PackageWeight: {
                UnitOfMeasurement: { Code: 'LBS', Description: 'Pounds' },
                Weight: String(pkg.weight),
            },
        };
        if (pkg.length && pkg.width && pkg.height) {
            p.Dimensions = {
                UnitOfMeasurement: { Code: 'IN', Description: 'Inches' },
                Length: String(pkg.length),
                Width: String(pkg.width),
                Height: String(pkg.height),
            };
        }
        return p;
    });

    const requestBody: any = {
        RateRequest: {
            Request: {
                SubVersion: '2403',
                TransactionReference: { CustomerContext: 'GMH-Dashboard-Rate' },
            },
            Shipment: {
                Shipper: shipper,
                ShipTo: {
                    Name: shipTo.name,
                    Address: {
                        AddressLine: [shipTo.addressLine1, shipTo.addressLine2].filter(Boolean),
                        City: shipTo.city,
                        StateProvinceCode: shipTo.state,
                        PostalCode: shipTo.postalCode,
                        CountryCode: shipTo.countryCode || 'US',
                    },
                },
                ShipFrom: {
                    Name: shipper.Name,
                    Address: shipper.Address,
                },
                Package: upsPackages,
                ShipmentRatingOptions: { NegotiatedRatesIndicator: '' },
            },
        },
    };

    // If no serviceCode, use "Shop" to get all available services
    if (serviceCode) {
        requestBody.RateRequest.Shipment.Service = { Code: serviceCode, Description: '' };
    }

    const requestType = serviceCode ? 'Rate' : 'Shop';
    const data = await upsRequest('POST', `/api/rating/v2403/${requestType}`, requestBody);

    const ratedShipments = data.RateResponse?.RatedShipment || [];
    const shipments = Array.isArray(ratedShipments) ? ratedShipments : [ratedShipments];

    return shipments.map((rs: any) => {
        const negotiated = rs.NegotiatedRateCharges?.TotalCharge;
        const charges = negotiated || rs.TotalCharges;
        return {
            serviceCode: rs.Service?.Code || '',
            serviceName: getServiceName(rs.Service?.Code || ''),
            totalCharges: charges?.MonetaryValue || '0.00',
            currency: charges?.CurrencyCode || 'USD',
            guaranteedDays: rs.GuaranteedDelivery?.BusinessDaysInTransit,
            scheduledDelivery: rs.GuaranteedDelivery?.DeliveryByTime,
            warnings: rs.RatedShipmentWarning
                ? (Array.isArray(rs.RatedShipmentWarning) ? rs.RatedShipmentWarning : [rs.RatedShipmentWarning])
                : undefined,
        };
    });
}

function getServiceName(code: string): string {
    const names: Record<string, string> = {
        '01': 'UPS Next Day Air',
        '02': 'UPS 2nd Day Air',
        '03': 'UPS Ground',
        '12': 'UPS 3 Day Select',
        '13': 'UPS Next Day Air Saver',
        '14': 'UPS Next Day Air Early',
        '59': 'UPS 2nd Day Air A.M.',
        '65': 'UPS Saver',
    };
    return names[code] || `UPS Service ${code}`;
}

// ─── Shipping (Create Label) ─────────────────────────────────────────────────

export async function createShipment(
    shipTo: UPSAddress,
    packages: UPSPackage[],
    serviceCode: string,
    description?: string,
): Promise<UPSShipmentResult> {
    const shipper = getShipperInfo();

    const upsPackages = packages.map((pkg) => {
        const p: any = {
            Description: pkg.description || description || 'Medical Supplies',
            Packaging: { Code: '02', Description: 'Customer Supplied Package' },
            PackageWeight: {
                UnitOfMeasurement: { Code: 'LBS', Description: 'Pounds' },
                Weight: String(pkg.weight),
            },
        };
        if (pkg.length && pkg.width && pkg.height) {
            p.Dimensions = {
                UnitOfMeasurement: { Code: 'IN', Description: 'Inches' },
                Length: String(pkg.length),
                Width: String(pkg.width),
                Height: String(pkg.height),
            };
        }
        return p;
    });

    const body = {
        ShipmentRequest: {
            Request: {
                SubVersion: '2409',
                TransactionReference: { CustomerContext: 'GMH-Dashboard-Ship' },
            },
            Shipment: {
                Description: description || 'Medical Supplies',
                Shipper: {
                    ...shipper,
                    AttentionName: shipper.Name,
                },
                ShipTo: {
                    Name: shipTo.name,
                    AttentionName: shipTo.name,
                    Phone: { Number: shipTo.phone || '' },
                    Address: {
                        AddressLine: [shipTo.addressLine1, shipTo.addressLine2].filter(Boolean),
                        City: shipTo.city,
                        StateProvinceCode: shipTo.state,
                        PostalCode: shipTo.postalCode,
                        CountryCode: shipTo.countryCode || 'US',
                    },
                },
                ShipFrom: {
                    Name: shipper.Name,
                    AttentionName: shipper.Name,
                    Phone: { Number: shipper.Phone.Number },
                    Address: shipper.Address,
                },
                PaymentInformation: {
                    ShipmentCharge: [
                        {
                            Type: '01', // Transportation
                            BillShipper: {
                                AccountNumber: shipper.ShipperNumber,
                            },
                        },
                    ],
                },
                Service: { Code: serviceCode, Description: getServiceName(serviceCode) },
                Package: upsPackages,
                ShipmentRatingOptions: { NegotiatedRatesIndicator: '' },
            },
            LabelSpecification: {
                LabelImageFormat: { Code: 'GIF', Description: 'GIF' },
                LabelStockSize: { Height: '6', Width: '4' },
            },
        },
    };

    const data = await upsRequest('POST', '/api/shipments/v2409/ship', body);

    const shipmentResults = data.ShipmentResponse?.ShipmentResults;
    if (!shipmentResults) {
        throw { code: 'NO_RESULTS', message: 'UPS returned no shipment results', details: JSON.stringify(data) } as UPSError;
    }

    const packageResults = shipmentResults.PackageResults;
    const pkgResult = Array.isArray(packageResults) ? packageResults[0] : packageResults;

    const negotiated = shipmentResults.NegotiatedRateCharges?.TotalCharge;
    const charges = negotiated || shipmentResults.ShipmentCharges?.TotalCharges;

    return {
        trackingNumber: pkgResult?.TrackingNumber || '',
        shipmentIdentificationNumber: shipmentResults.ShipmentIdentificationNumber || '',
        labelImageFormat: pkgResult?.ShippingLabel?.ImageFormat?.Code || 'GIF',
        labelImageBase64: pkgResult?.ShippingLabel?.GraphicImage || '',
        totalCharges: charges?.MonetaryValue || '0.00',
        currency: charges?.CurrencyCode || 'USD',
    };
}

// ─── Tracking ────────────────────────────────────────────────────────────────

export async function trackShipment(trackingNumber: string): Promise<UPSTrackingResult> {
    const data = await upsRequest('GET', `/api/track/v1/details/${trackingNumber}?locale=en_US&returnSignature=false`);

    const trackResponse = data.trackResponse;
    const shipment = trackResponse?.shipment?.[0];
    const pkg = shipment?.package?.[0];

    if (!pkg) {
        throw { code: 'NOT_FOUND', message: `No tracking data found for ${trackingNumber}` } as UPSError;
    }

    const currentActivity = pkg.activity?.[0];
    const currentStatus = currentActivity?.status;
    const deliveryDate = pkg.deliveryDate?.[0];

    const activities: UPSTrackingActivity[] = (pkg.activity || []).map((act: any) => ({
        status: act.status?.description || '',
        statusCode: act.status?.code || '',
        description: act.status?.description || '',
        location: [
            act.location?.address?.city,
            act.location?.address?.stateProvince,
            act.location?.address?.countryCode,
        ].filter(Boolean).join(', '),
        date: act.date || '',
        time: act.time || '',
    }));

    return {
        trackingNumber,
        currentStatus: currentStatus?.description || 'Unknown',
        statusCode: currentStatus?.code || '',
        estimatedDelivery: deliveryDate?.date,
        deliveredDate: currentStatus?.code === '011' ? currentActivity?.date : undefined,
        activities,
    };
}

// ─── Void (Cancel) ───────────────────────────────────────────────────────────

export async function voidShipment(shipmentIdentificationNumber: string): Promise<boolean> {
    const data = await upsRequest(
        'DELETE',
        `/api/shipments/v2409/void/cancel/${shipmentIdentificationNumber}`,
    );

    const voidStatus = data.VoidShipmentResponse?.SummaryResult?.Status?.Code;
    return voidStatus === '1'; // 1 = success
}
