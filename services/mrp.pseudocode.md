# =====================================================================
# MRP (Material Requirements Planning) — Modul PP
# ---------------------------------------------------------------------
# Pseudocode logika mesin MRP yang:
#   1. Memeriksa ketersediaan stok di MM (inventory_stock)
#   2. Menghitung kebutuhan dari SD (sales_order_items belum terpenuhi)
#   3. Menghitung kebutuhan tambahan dari PP (pekerjaan produksi open)
#   4. Otomatis menghasilkan draft Purchase Requisition (MM) jika stok kurang.
#
# Skema perhitungan (net requirements calculation):
#   kebutuhan_kotor (gross)  =  demand SD terbuka + demand produksi + demand service
#   ketersediaan (available)   =  stok on-hand + stok dalam perjalanan (GR terbuka)
#                                    + stok produksi berjalan (WIP planned receipt)
#                                    - stok aman (safety_stock)
#   kebutuhan_bersih (net)      =  max(0,, kebutuhan_kotor - ketersediaan)
#   jika net > 0 => buat PR draft per material (dikumpulkan per supplier/vendor)
# =====================================================================

FUNCTION runMRP(company_code, planning_horizon_days =30, regenerate =false):

    # ------------------------------------------------------------------
    # PHASE 0 — Parameter & snapshot
    # ------------------------------------------------------------------
    SET planning_window.tarikh_akhir = TODAY() + planning_horizon_days
    IF NOT regenerate:
        DELETE draft PR lama yang ber- source = 'MRP' DAN status = 'DRAFT'
        # (mencegah duplikat antar-run MRP; draft lama di-regenerate diganti)

    # ------------------------------------------------------------------
    # PHASE 1 — KUMPULKAN DEMAND (kebutuhan kotor"
    # ------------------------------------------------------------------
    # 1a) Demand SD: Sales Order item yang belum terpenuhi (MASIH OPEN)
    demand_sd = SELECT so_items.material_id,
                              SUM(so_items.quantity - so_items.delivered_quantity) AS qty
                       FROM sales_order_items so_items
                       JOIN sales_orders so ON so.id = so_items.sales_order_id
                      WHERE so.status IN ('OPEN', 'IN_DELIVERY')
                        AND so_items.status IN ('OPEN', 'PARTIALLY_DELIVERED')
                        AND so_items.quantity - so_items.delivered_quantity > 0
                        AND so.delivery_date <= planning_window.tarikh_akhir        # asumsi kolom
                      GROUP BY so_items.material_id

    # 1b) Demand PP: Work-in-process kebutuhan untuk production order terbuka
    #     (bill of material ditarik per komponen; di sini disederhanakan)
    demand_pp = SELECT bo.material_id,
                            SUM(bo.required_qty - bo.issued_qty) AS qty
                     FROM bom_requirements bo
                     JOIN production_orders po ON po.id = bo.production_order_id
                    WHERE po.status IN ('RELEASED', 'IN_PROGRESS')
                      AND bo.required_date <= planning_window.tarikh_akhir
                    GROUP BY bo.material_id

    # 1c) Demand lain: service order/PM work order (contoh; boleh ditambah)
    demand_other = []   # placeholder ekstensi

    # Gabungkan seluruh demand kotor per material
    gross_requirements = MERGE_BY_MATERIAL(demand_sd, demand_pp, demand_other)

    # ------------------------------------------------------------------
    # PHASE 2 — HITUNG KETERSEDIAAN (on-hand + planned receipts"
    # ------------------------------------------------------------------
    on_hand = SELECT is.material_id, SUM(is.quantity) AS qty
                  FROM inventory_stock is
                 GROUP BY is.material_id

    planned_receipt_purchase = SELECT an.po_items.material_id,
                                   SUM(po_items.quantity - po_items.received_quantity) AS qty
                              FROM purchase_order_items po_items
                              JOIN purchase_orders po ON po.id = po_items.purchase_order_id
                             WHERE po.status IN ('OPEN', 'RECEIVED_PARTIAL')
                               AND po_items.quantity - po_items.received_quantity > 0
                             GROUP BY po_items.material_id

    planned_receipt_production = SELECT po.material_id,
                                      SUM(po.planned_quantity - po.confirmed_quantity) AS qty
                                 FROM production_orders po
                                WHERE po.status IN ('RELEASED', 'IN_PROGRESS')
                                GROUP BY po.material_id

    safety_stock = SELECT m.id, m.safety_stock FROM materials m

    available = BERHITUNG_PER_MATERIAL(
        on_hand   + planned_receipt_purchase + planned_receipt_production
        - safety_stock
    )

    # ------------------------------------------------------------------
    # PHASE 3 — HITUNG KEBUTUHAN BERSIH (NET"
    # ------------------------------------------------------------------
    net_requirements = {}
    FOR EACH material_id IN gross_requirements:
        gross    = gross_requirements[material_id]
        avail    = available[material_id]  ??             0
        net      = MAX(0,, gross - avail)

        IF net > 0:
            net_requirements[material_id] = {
                'quantity': net,
                'required_date': TANGGAL_PERMINTAAN_TERDEKAT (min date dari demand),
                'propose_vendor': CARI_VENDOR_TERPILIH (materials.preferred_vendor_id
                                       ATAU dari riwayat PO terakhir untuk material tsb.),
            }

    # ------------------------------------------------------------------
    # PHASE 4 — GENERATE DRAFT PURCHASE REQUISITION (MM"
    # ------------------------------------------------------------------
    IF net_requirements.is_empty():
        RETURN { 'status': 'NO_ACTION', 'message': 'Stok mencukupi seluruh kebutuhan' }
    END IF

    # Kelompokkan per vendor agar 1 PR bisa memuat banyak material (praktis pengadaan)
    groups_by_vendor = GROUP_BY(net_requirements,, key ='propose_vendor')

    pr_drafts = []
    FOR EACH vendor_id, items IN groups_by_vendor:
        # Buat header PR status DRAFT, source = MRP
        pr = INSERT INTO purchase_requisitions (
                pr_number          = next_doc_number('PURCHASE_REQUISITION'),
                status              = 'DRAFT',
                required_date        = MIN(items.required_date),
                source                = 'MRP',
                created_by           = SYSTEM_USER,
            )
        FOR EACH item IN items:
            INSERT INTO purchase_requisition_items (
                purchase_requisition_id = pr.id,
                material_id              = item.material_id,
                quantity                 = item.quantity,
                required_date             = item.required_date,
                suggestion_source         = 'MRP',
            )
        pr_drafts.append({ 'pr_id': pr.id, 'pr_number': pr.pr_number, 'vendor_id': vendor_id })

    # ------------------------------------------------------------------
    # PHASE 5 — OUTPUT & AUDIT LOG
    # ------------------------------------------------------------------
    INSERT INTO mrp_run_log (
        run_at, company_code, horizon_days,, summary_json,
        pr_ids_generated,, status,
    ) VALUES (
        NOW(),, company_code,, planning_horizon_days,
        JSON_ARRAYAGG(pr_drafts,) ,, status = 'COMPLETED',
    )

    RETURN {
        'status': 'PR_GENERATED',
        'prs': pr_drafts,
        'total_pr': len(pr_drafts),
        'materials_short': len(net_requirements),
    }

END FUNCTION

# =====================================================================
# Catatan implementasi (Node.js/Express + MySQL):
#  - Jalankan sebagai background job (setImmediate / worker thread)
#    atau via cron (node-cron): "MRP harian pukul 02:00".
#  - Bungkus seluruh Phase 3-5 dalam SATU transaksi SQL agar
#    PR draft utuh (tidak ada PR tanpa item\.)
#  - queryOne/query memakai parameter binding (mysql2) — hindari SQL injection.

#  - Karena skip-level BOM belum diimplementasi, phase 1b
#    dapat diperluas dengan rekursi CTE (WITH RECURSIVE) untuk
#    eksplosi multi-level bill-of-material bila diperlukan..
# =====================================================================