-- Alpha BioMed and ABXTAC specialty pharmacy order tables
-- Mirrors farmakaio_orders schema exactly (the generic pharmacy order shape)

CREATE TABLE IF NOT EXISTS alphabiomed_orders (
    order_id                uuid                     PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_name            varchar(255)             NOT NULL,
    medication_ordered      varchar(255),
    dose                    varchar(100),
    order_number            varchar(100),
    date_ordered            date,
    status                  varchar(50)              DEFAULT 'Pending',
    order_in_chart          boolean                  DEFAULT false,
    ordered_to              varchar(100),
    patient_received        varchar(100),
    notes                   text,
    is_office_use           boolean                  DEFAULT false,
    pdf_s3_key              varchar(500),
    healthie_patient_id     varchar(50),
    healthie_patient_name   varchar(255),
    healthie_document_id    varchar(50),
    uploaded_to_healthie_at timestamp with time zone,
    created_at              timestamp with time zone DEFAULT now(),
    updated_at              timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alphabiomed_orders_date ON alphabiomed_orders (date_ordered DESC);
CREATE INDEX IF NOT EXISTS idx_alphabiomed_orders_status ON alphabiomed_orders (status);

CREATE TABLE IF NOT EXISTS abxtac_orders (
    order_id                uuid                     PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_name            varchar(255)             NOT NULL,
    medication_ordered      varchar(255),
    dose                    varchar(100),
    order_number            varchar(100),
    date_ordered            date,
    status                  varchar(50)              DEFAULT 'Pending',
    order_in_chart          boolean                  DEFAULT false,
    ordered_to              varchar(100),
    patient_received        varchar(100),
    notes                   text,
    is_office_use           boolean                  DEFAULT false,
    pdf_s3_key              varchar(500),
    healthie_patient_id     varchar(50),
    healthie_patient_name   varchar(255),
    healthie_document_id    varchar(50),
    uploaded_to_healthie_at timestamp with time zone,
    created_at              timestamp with time zone DEFAULT now(),
    updated_at              timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abxtac_orders_date ON abxtac_orders (date_ordered DESC);
CREATE INDEX IF NOT EXISTS idx_abxtac_orders_status ON abxtac_orders (status);
