-- ========================================
-- MISES À JOUR DE LA BASE DE DONNÉES SUPABASE
-- ========================================

-- 1. Ajouter les champs pour suivre qui a ouvert la table (utilise UUID pour la clé étrangère)
ALTER TABLE tables 
ADD COLUMN IF NOT EXISTS opened_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS opened_by_name TEXT;

-- 2. Ajouter le champ pour suivre qui a ajouté un article dans order_items (utilise UUID pour la clé étrangère)
ALTER TABLE order_items 
ADD COLUMN IF NOT EXISTS created_by_server_id UUID REFERENCES users(id);

-- 2b. Ajouter le champ pour suivre l'impression des "à suivre" (plan)
ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS printed_plan_at TIMESTAMPTZ;

-- 2c. Ajouter le champ pour suivre l'impression des items "fired" (direct)
ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS printed_fired_at TIMESTAMPTZ;

-- 3. Ajouter les champs pour suivre les articles offerts dans les statistiques
ALTER TABLE daily_sales 
ADD COLUMN IF NOT EXISTS complimentary_amount DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS complimentary_count INTEGER DEFAULT 0;

-- 3b. Ajouter la TVA par défaut sur les suppléments
ALTER TABLE supplements
ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5,2) DEFAULT 10;

-- 3c. Ajouter la permission d'accès au bouton Addition par utilisateur
ALTER TABLE users
ADD COLUMN IF NOT EXISTS can_access_bill BOOLEAN DEFAULT FALSE;

-- 4. Créer des index pour optimiser les performances
CREATE INDEX IF NOT EXISTS idx_tables_opened_by ON tables(opened_by);
CREATE INDEX IF NOT EXISTS idx_order_items_created_by_server_id ON order_items(created_by_server_id);
CREATE INDEX IF NOT EXISTS idx_order_items_printed_plan_at ON order_items(printed_plan_at);
CREATE INDEX IF NOT EXISTS idx_order_items_printed_fired_at ON order_items(printed_fired_at);
CREATE INDEX IF NOT EXISTS idx_daily_sales_complimentary ON daily_sales(date, server_id);
CREATE INDEX IF NOT EXISTS idx_orders_table_status_created_at ON orders(table_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order_status_created_at ON order_items(order_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_order_created_at ON payments(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_supplements_order_id ON supplements(order_id);

-- 5. Mettre à jour les tables existantes (optionnel)
-- Décommentez si vous voulez nettoyer les données existantes
-- UPDATE tables SET opened_by = NULL, opened_by_name = NULL WHERE opened_by IS NOT NULL;
-- UPDATE order_items SET created_by_server_id = NULL WHERE created_by_server_id IS NOT NULL;
-- UPDATE daily_sales SET complimentary_amount = 0, complimentary_count = 0 WHERE complimentary_amount IS NOT NULL;
-- UPDATE users SET can_access_bill = TRUE WHERE role = 'manager';

-- ========================================
-- VÉRIFICATION
-- ========================================

-- Vérifier que les colonnes ont été ajoutées
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name IN ('tables', 'order_items', 'daily_sales', 'users') 
AND column_name IN ('opened_by', 'opened_by_name', 'created_by_server_id', 'printed_plan_at', 'printed_fired_at', 'complimentary_amount', 'complimentary_count', 'can_access_bill')
ORDER BY table_name, column_name;
