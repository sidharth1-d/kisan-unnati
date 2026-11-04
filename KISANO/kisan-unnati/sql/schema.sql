-- =================================================================================
-- KISAN UNNATI: DECISION SUPPORT SYSTEM (TY BCA PROJECT)
-- PostgreSQL / Supabase 10-Table Relational Schema (3NF)
-- =================================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. FARMERS TABLE
CREATE TABLE farmers (
    farmer_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_hash VARCHAR(64) UNIQUE,
    preferred_lang VARCHAR(5) DEFAULT 'mr' CHECK (preferred_lang IN ('mr', 'hi', 'en')),
    land_size_acres NUMERIC(6,2) DEFAULT 2.50,
    social_category VARCHAR(30) DEFAULT 'General',
    has_irrigation BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. FARM PLOTS TABLE (Captures "Are you at farmland?" GPS vs. Satellite Pin-Drop)
CREATE TABLE farm_plots (
    plot_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    farmer_id UUID REFERENCES farmers(farmer_id) ON DELETE CASCADE,
    lat NUMERIC(9,6) NOT NULL,
    lon NUMERIC(9,6) NOT NULL,
    gps_accuracy_m NUMERIC(6,1),
    is_on_field_gps BOOLEAN DEFAULT TRUE,
    village VARCHAR(100),
    taluka VARCHAR(100),
    district VARCHAR(100) NOT NULL,
    state VARCHAR(100) DEFAULT 'Maharashtra',
    agro_climatic_zone VARCHAR(120),
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. SOIL & WEATHER SNAPSHOTS (Live Open-Meteo + ISRIC SoilGrids cache)
CREATE TABLE soil_weather_snapshots (
    snapshot_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plot_id UUID REFERENCES farm_plots(plot_id) ON DELETE CASCADE,
    temp_c NUMERIC(4,1),
    rain_prob_pct INT,
    wind_speed_kmh NUMERIC(5,1),
    et0_mm NUMERIC(4,2),
    moisture_0_7cm NUMERIC(4,3),
    moisture_7_28cm NUMERIC(4,3),
    soil_ph NUMERIC(3,1),
    soil_nitrogen_mgkg INT,
    soil_texture VARCHAR(60),
    spray_window_safe BOOLEAN DEFAULT TRUE,
    snapshot_time TIMESTAMPTZ DEFAULT NOW()
);

-- 4. CROP MASTER TABLE
CREATE TABLE crop_master (
    crop_id VARCHAR(40) PRIMARY KEY,
    name_en VARCHAR(100) NOT NULL,
    name_mr VARCHAR(100) NOT NULL,
    name_hi VARCHAR(100) NOT NULL,
    season VARCHAR(20) CHECK (season IN ('Kharif', 'Rabi', 'Zaid', 'Annual')),
    min_ph NUMERIC(3,1),
    max_ph NUMERIC(3,1),
    min_moisture_m3 NUMERIC(4,3),
    water_req_mm INT,
    duration_days INT,
    cultivation_cost_acre INT NOT NULL,
    expected_yield_qtl_acre NUMERIC(5,2) NOT NULL,
    base_mandi_price_qtl INT NOT NULL,
    price_volatility_cv NUMERIC(4,2) DEFAULT 0.15,
    enso_drought_sensitivity NUMERIC(3,2) DEFAULT 0.20,
    storage_type_needed VARCHAR(30) CHECK (storage_type_needed IN ('DRY_GODOWN', 'COLD_STORAGE', 'ONION_CHAWL'))
);

-- 5. CLIMATE RISK INDICES (NOAA El Nino / La Nina ONI + IMD Seasonal Weights)
CREATE TABLE climate_risk_indices (
    index_id SERIAL PRIMARY KEY,
    season_label VARCHAR(50) NOT NULL,
    enso_phase VARCHAR(30) CHECK (enso_phase IN ('El Nino', 'La Nina', 'Neutral')),
    oni_anomaly_c NUMERIC(3,2),
    iod_phase VARCHAR(30),
    drought_penalty_weight NUMERIC(3,2),
    unseasonal_rain_weight NUMERIC(3,2),
    advisory_mr TEXT,
    advisory_hi TEXT,
    advisory_en TEXT,
    updated_at DATE DEFAULT CURRENT_DATE
);

-- 6. SEED VARIETIES & VENDORS (Mahabeej / ICAR / Bio-Treatment Rules)
CREATE TABLE seed_varieties_vendors (
    seed_id VARCHAR(40) PRIMARY KEY,
    crop_id VARCHAR(40) REFERENCES crop_master(crop_id) ON DELETE CASCADE,
    variety_name_en VARCHAR(100),
    variety_name_mr VARCHAR(100),
    variety_name_hi VARCHAR(100),
    seed_rate_kg_per_acre NUMERIC(5,1) NOT NULL,
    seed_cost_per_kg INT NOT NULL,
    row_spacing_cm VARCHAR(30),
    treatment_rule_mr TEXT,
    treatment_rule_hi TEXT,
    treatment_rule_en TEXT,
    vendor_agency VARCHAR(80) DEFAULT 'Mahabeej / Krishi Seva Kendra',
    sathi_portal_url TEXT DEFAULT 'https://seedtrace.gov.in/'
);

-- 7. MANDI RATES CACHE (With Lat/Lon & Hamali for Net Arbitrage Calculation)
CREATE TABLE mandi_rates_cache (
    rate_id SERIAL PRIMARY KEY,
    market_name_en VARCHAR(100),
    market_name_mr VARCHAR(100),
    district VARCHAR(80),
    lat NUMERIC(9,6) NOT NULL,
    lon NUMERIC(9,6) NOT NULL,
    crop_id VARCHAR(40) REFERENCES crop_master(crop_id),
    modal_price_qtl INT NOT NULL,
    min_price_qtl INT,
    max_price_qtl INT,
    hamali_weighing_per_qtl INT DEFAULT 35,
    arrival_tonnes INT,
    updated_date DATE DEFAULT CURRENT_DATE
);

-- 8. STORAGE FACILITIES (Cold Storage, Onion Chawl & MSWC Godowns)
CREATE TABLE storage_facilities (
    facility_id VARCHAR(40) PRIMARY KEY,
    name_en VARCHAR(140) NOT NULL,
    name_mr VARCHAR(140) NOT NULL,
    facility_type VARCHAR(30) CHECK (facility_type IN ('DRY_GODOWN', 'COLD_STORAGE', 'ONION_CHAWL')),
    district VARCHAR(80),
    taluka VARCHAR(80),
    lat NUMERIC(9,6) NOT NULL,
    lon NUMERIC(9,6) NOT NULL,
    capacity_mt INT,
    rent_per_qtl_month INT NOT NULL,
    supports_pledge_loan BOOLEAN DEFAULT FALSE,
    pledge_loan_ltv_pct INT DEFAULT 75,
    pledge_interest_pct NUMERIC(4,2) DEFAULT 5.00,
    expected_90d_price_gain_qtl INT DEFAULT 650,
    contact_phone VARCHAR(20)
);

-- 9. CONTRACT FARMING & FPO BUYBACK OFFERS
CREATE TABLE contract_farming_offers (
    offer_id VARCHAR(40) PRIMARY KEY,
    sponsor_org_en VARCHAR(120) NOT NULL,
    sponsor_org_mr VARCHAR(120) NOT NULL,
    crop_id VARCHAR(40) REFERENCES crop_master(crop_id),
    required_variety VARCHAR(100),
    guaranteed_floor_price_qtl INT NOT NULL,
    market_premium_pct INT DEFAULT 15,
    min_acreage NUMERIC(4,1) DEFAULT 1.0,
    eligible_districts TEXT[],
    inputs_provided BOOLEAN DEFAULT TRUE,
    registration_deadline DATE,
    apply_url TEXT
);

-- 10. GOVERNMENT SCHEMES MASTER
CREATE TABLE gov_schemes (
    scheme_id VARCHAR(40) PRIMARY KEY,
    title_en VARCHAR(160) NOT NULL,
    title_mr VARCHAR(160) NOT NULL,
    title_hi VARCHAR(160) NOT NULL,
    level VARCHAR(30) CHECK (level IN ('Central', 'MahaDBT', 'PoCRA')),
    subsidy_summary_mr VARCHAR(160),
    subsidy_summary_hi VARCHAR(160),
    subsidy_summary_en VARCHAR(160),
    eligible_states TEXT[],
    eligible_districts TEXT[],
    max_land_ha NUMERIC(4,1) DEFAULT 5.0,
    documents_mr TEXT[],
    documents_en TEXT[],
    apply_url TEXT NOT NULL
);

CREATE INDEX idx_plots_district ON farm_plots(district, taluka);
CREATE INDEX idx_mandi_crop ON mandi_rates_cache(crop_id, district);
CREATE INDEX idx_storage_type ON storage_facilities(facility_type, district);