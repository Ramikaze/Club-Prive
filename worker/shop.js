// The boutique: regular clients (registered buyers who are not members) and the hidden walk-in client. All
// writes run inside the API transaction, including audit and idempotency.
import { conflict } from './errors.js';

export const shopMethods = {
  // The one hidden row every walk-in sale is booked on, created on first use. It has no card and no file: it is
  // never listed, searched, renewed or counted, and fileRow() refuses to open it.
  walkInMemberId() {
    const row = this.get("SELECT id FROM members WHERE kind = 'journalier'");
    if (row) return row.id;
    return this.insert(
      `INSERT INTO members (member_no, first_name, last_name, phone, kind, created_at) VALUES ('J-0000', 'Client', 'JOURNALIER', '', 'journalier', ?)`,
      this.nowIso(),
    );
  },

  // Regular clients only, with what they bought (cancelled sales left out).
  listClients(q, statut = 'actifs') {
    const keep = this.keepByStatus(statut);
    return this.searchMemberRows(q, 'client').filter(keep).map((m) => {
      const bought = this.get(
        `SELECT COUNT(*) AS n, MAX(s.created_at) AS last_at,
           COALESCE((SELECT SUM(c.amount) FROM charges c JOIN shop_sales x ON x.id = c.shop_sale_id
                     WHERE x.member_id = ? AND x.cancelled_at IS NULL), 0) AS total
         FROM shop_sales s WHERE s.member_id = ? AND s.cancelled_at IS NULL`, m.id, m.id,
      );
      return { ...this.memberBase(m), purchases_count: bought.n, purchases_total: bought.total, last_purchase_at: bought.last_at ?? null };
    });
  },

  createClient(actor, input) {
    const f = this.memberFields(input);
    const memberNo = this.nextMemberNo('C');
    const id = this.insert(
      `INSERT INTO members (member_no, first_name, last_name, phone, email, notes, kind, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'client', ?, ?)`,
      memberNo, f.first, f.last, f.phone, f.email, f.notes, this.nowIso(), actor.id,
    );
    this.audit(actor, 'client.creer', 'member', id, { member_no: memberNo, nom: `${f.first} ${f.last}` });
    return this.memberDetail(id);
  },

  // The client becomes a member on the same row, so every purchase stays attached; the old number is kept.
  convertClient(actor, id) {
    const m = this.fileRow(id);
    if (m.kind !== 'client') throw conflict('PAS_CLIENT', `${m.first_name} ${m.last_name} est déjà membre.`);
    const memberNo = this.nextMemberNo('M');
    const now = this.nowIso();
    this.run(
      `UPDATE members SET kind = 'membre', former_client_no = ?, member_no = ?, became_member_at = ?, became_member_by = ?,
         updated_at = ?, updated_by = ? WHERE id = ?`,
      m.member_no, memberNo, now, actor.id, now, actor.id, m.id,
    );
    this.ensureCard(actor, m.id);
    this.audit(actor, 'client.passer_membre', 'member', m.id, {
      ancien_numero: m.member_no, nouveau_numero: memberNo, nom: `${m.first_name} ${m.last_name}`,
    });
    return this.memberDetail(m.id);
  },
};
