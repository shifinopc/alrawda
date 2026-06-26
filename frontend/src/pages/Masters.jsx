import React, { useEffect, useMemo, useState } from 'react';
import { api, fmtMoney, fmtDate } from '../api';
import { Select, useToast, useConfirm, Panel, Field, Empty, Drawer, Badge, Loader } from '../components/ui';
import { usePerms } from '../permissions';

const TABS = [
  { id: 'packages', label: 'Packages', icon: 'ti-package' },
  { id: 'visa', label: 'Visa Type', icon: 'ti-id-badge-2' },
  { id: 'nationality', label: 'Nationality', icon: 'ti-flag' },
  { id: 'customer', label: 'Customer', icon: 'ti-users' },
  { id: 'agent', label: 'Agent', icon: 'ti-user-star' },
];

const CONFIGS = {
  packages: {
    title: 'Packages',
    singular: 'Package',
    base: '/api/masters/packages',
    idKey: 'PackageCode',
    auditType: 'package',
    nameKey: 'PackageName',
    canDelete: true,
    searchKeys: ['PackageCode', 'PackageName'],
    columns: [
      { label: 'Code', render: (r) => r.PackageCode },
      { label: 'Package Name', render: (r) => r.PackageName },
      { label: 'Rate (QAR)', className: 'num', render: (r) => fmtMoney(r.Rate) },
    ],
    emptyForm: { packageName: '', rate: '' },
    fromRow: (r) => ({ packageName: r.PackageName ?? '', rate: r.Rate ?? '' }),
    toBody: (f) => ({ packageName: f.packageName.trim(), rate: Number(f.rate || 0) }),
    validate: (f) => {
      if (!f.packageName.trim()) return { field: 'packageName', message: 'Package Name is required' };
      if (f.rate === '' || f.rate === null) return { field: 'rate', message: 'Rate is required' };
      return null;
    },
    fields: [
      { key: 'packageName', label: 'Package Name', required: true, placeholder: 'e.g. Umrah Economy' },
      { key: 'rate', label: 'Rate (QAR)', required: true, type: 'number' },
    ],
  },
  agent: {
    title: 'Agents',
    singular: 'Agent',
    base: '/api/masters/agents',
    idKey: 'AgentCode',
    auditType: 'agent',
    nameKey: 'AgentName',
    canDelete: true,
    searchKeys: ['AgentCode', 'AgentName', 'MobileNo'],
    columns: [
      { label: 'Code', render: (r) => r.AgentCode },
      { label: 'Agent Name', render: (r) => r.AgentName },
      { label: 'Mobile', render: (r) => r.MobileNo },
    ],
    emptyForm: { agentName: '', mobileNo: '' },
    fromRow: (r) => ({ agentName: r.AgentName ?? '', mobileNo: r.MobileNo ?? '' }),
    toBody: (f) => ({ agentName: f.agentName.trim(), mobileNo: f.mobileNo.trim() }),
    validate: (f) => (!f.agentName.trim() ? { field: 'agentName', message: 'Agent Name is required' } : null),
    fields: [
      { key: 'agentName', label: 'Agent Name', required: true, placeholder: 'e.g. Travel Partner LLC' },
      { key: 'mobileNo', label: 'Mobile No', placeholder: '+974 …' },
    ],
  },
  visa: {
    title: 'Visa Types',
    singular: 'Visa Type',
    base: '/api/masters/visa-types',
    idKey: 'VisaTypeCode',
    auditType: 'visa-type',
    nameKey: 'VisaType',
    canDelete: true,
    searchKeys: ['VisaTypeCode', 'VisaType'],
    columns: [
      { label: 'Code', render: (r) => r.VisaTypeCode },
      { label: 'Visa Type', render: (r) => r.VisaType },
      { label: 'Amount (QAR)', className: 'num', render: (r) => fmtMoney(r.VisaAmount) },
    ],
    emptyForm: { visaType: '', visaAmount: '' },
    fromRow: (r) => ({ visaType: r.VisaType ?? '', visaAmount: r.VisaAmount ?? '' }),
    toBody: (f) => ({ visaType: f.visaType.trim(), visaAmount: Number(f.visaAmount || 0) }),
    validate: (f) => (!f.visaType.trim() ? { field: 'visaType', message: 'Visa Type is required' } : null),
    fields: [
      { key: 'visaType', label: 'Visa Type', required: true, placeholder: 'e.g. Tourist Visa' },
      { key: 'visaAmount', label: 'Visa Amount (QAR)', type: 'number' },
    ],
  },
  nationality: {
    title: 'Nationalities',
    singular: 'Nationality',
    base: '/api/masters/nationalities',
    idKey: 'CountryCode',
    auditType: 'nationality',
    nameKey: 'CountryName',
    canDelete: true,
    searchKeys: ['CountryCode', 'CountryName', 'CntShortName'],
    columns: [
      { label: 'Code', render: (r) => r.CountryCode },
      { label: 'Country', render: (r) => r.CountryName },
      { label: 'Short', render: (r) => r.CntShortName },
      { label: 'Arabic', className: 'ar', render: (r) => r.CountryNameinArabic },
    ],
    emptyForm: { countryName: '', shortName: '', nameArabic: '' },
    fromRow: (r) => ({
      countryName: r.CountryName ?? '',
      shortName: r.CntShortName ?? '',
      nameArabic: r.CountryNameinArabic ?? '',
    }),
    toBody: (f) => ({
      countryName: f.countryName.trim(),
      shortName: f.shortName.trim(),
      nameArabic: f.nameArabic.trim(),
    }),
    validate: (f) => (!f.countryName.trim() ? { field: 'countryName', message: 'Country Name is required' } : null),
    fields: [
      { key: 'countryName', label: 'Country Name', required: true },
      { key: 'shortName', label: 'Short Name', placeholder: 'e.g. IND' },
      { key: 'nameArabic', label: 'Name in Arabic', className: 'ar', placeholder: 'الاسم' },
    ],
  },
  customer: {
    title: 'Customers',
    singular: 'Customer',
    base: '/api/masters/customer-master',
    idKey: 'CustomerCode',
    auditType: 'customer',
    nameKey: 'CustomerName',
    canDelete: true,
    serverSearch: true, // 6,900+ customers — search the whole table on the server, not the loaded page
    searchKeys: ['CustomerCode', 'CustomerName', 'MobileNo', 'EMailID'],
    columns: [
      { label: 'Code', render: (r) => r.CustomerCode },
      { label: 'Customer', render: (r) => r.CustomerName },
      { label: 'Mobile', render: (r) => r.MobileNo },
      { label: 'Nationality', render: (r) => r.CountryName },
    ],
    emptyForm: { customerName: '', countryCode: '', mobileNo: '', email: '', address: '' },
    fromRow: (r) => ({
      customerName: r.CustomerName ?? '',
      countryCode: r.CountryCode ?? '',
      mobileNo: r.MobileNo ?? '',
      email: r.EMailID ?? '',
      address: r.LocalAddress ?? '',
    }),
    toBody: (f) => ({
      customerName: f.customerName.trim(),
      countryCode: f.countryCode ? Number(f.countryCode) : null,
      mobileNo: f.mobileNo.trim(),
      email: f.email.trim(),
      address: f.address.trim(),
    }),
    validate: (f) => (!f.customerName.trim() ? { field: 'customerName', message: 'Customer Name is required' } : null),
    fields: [
      { key: 'customerName', label: 'Customer Name', required: true },
      {
        key: 'countryCode', label: 'Nationality', type: 'select',
        optionsFrom: '/api/masters/nationalities', optionValue: 'CountryCode', optionLabel: 'CountryName',
      },
      { key: 'mobileNo', label: 'Mobile No 1', placeholder: '+974 …' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'address', label: 'Address' },
    ],
  },
};

const ACTION_TONE = { create: 'green', update: 'warn', delete: 'red' };
const ACTION_LABEL = { create: 'Created', update: 'Updated', delete: 'Deleted' };

const fmtVal = (v) => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  return !isNaN(n) && String(v).trim() !== '' && /^[\d.]+$/.test(String(v).trim()) ? fmtMoney(n) : String(v);
};

function HistoryDrawer({ config, record, onClose }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams({ type: config.auditType });
    if (record) params.set('code', record[config.idKey]);
    api.get(`/api/masters/history?${params}`)
      .then((d) => setRows(d.rows || []))
      .catch((e) => { toast(e.message); setRows([]); });
  }, [config, record]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Drawer
      title={record
        ? `History — ${record[config.nameKey]} (${record[config.idKey]})`
        : `History — all ${config.title.toLowerCase()}`}
      onClose={onClose}
    >
      {!rows ? (
        <Loader />
      ) : rows.length === 0 ? (
        <Empty icon="ti-history" text="No changes recorded yet. Edits made from now on are tracked here." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((h) => (
            <div key={h.id} style={{ border: '1px solid var(--line)', borderRadius: 11, padding: '10px 13px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Badge tone={ACTION_TONE[h.action] || 'blue'}>{ACTION_LABEL[h.action] || h.action}</Badge>
                <b>{h.record_name || `#${h.record_code}`}</b>
                {!record && <small className="muted">#{h.record_code}</small>}
              </div>
              {(h.changes || []).map((c, i) => (
                <div key={i} style={{ fontSize: 12.5, padding: '3px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="muted" style={{ minWidth: 110 }}>{c.field}</span>
                  {h.action === 'create' ? (
                    <b style={{ color: 'var(--green)' }}>{fmtVal(c.new)}</b>
                  ) : h.action === 'delete' ? (
                    <s className="muted">{fmtVal(c.old)}</s>
                  ) : (
                    <>
                      <s className="muted">{fmtVal(c.old)}</s>
                      <i className="ti ti-arrow-right" style={{ color: 'var(--accent)' }} />
                      <b style={{ color: 'var(--accent2)' }}>{fmtVal(c.new)}</b>
                    </>
                  )}
                </div>
              ))}
              <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                <i className="ti ti-user" /> {h.changed_by_name || 'System'} · {new Date(h.created_at).toLocaleString('en-GB', {
                  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}

function MasterTab({ config }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = usePerms();
  const canEdit = can('Master Data', 'Create') || can('Master Data', 'Edit');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(config.emptyForm);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState(false);
  const [options, setOptions] = useState({});

  useEffect(() => {
    config.fields
      .filter((f) => f.type === 'select' && f.optionsFrom)
      .forEach((f) => {
        api.get(f.optionsFrom)
          .then((d) => setOptions((o) => ({ ...o, [f.key]: d.rows || [] })))
          .catch(() => {});
      });
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async (query) => {
    setLoading(true);
    try {
      const url = config.serverSearch && query && query.trim()
        ? `${config.base}?q=${encodeURIComponent(query.trim())}&pageSize=100`
        : config.base;
      const data = await api.get(url);
      setRows(data.rows || []);
    } catch (e) {
      toast(e.message);
    } finally {
      setLoading(false);
    }
  };

  // small masters (packages/visa/nationality) load once and filter in-browser;
  // the large customer master searches the whole table on the server (debounced)
  useEffect(() => { if (!config.serverSearch) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!config.serverSearch) return undefined;
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (config.serverSearch) return rows; // already filtered by the server
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) =>
      config.searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(t))
    );
  }, [rows, q, config]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => (er[key] ? { ...er, [key]: undefined } : er));
  };

  const selectRow = (r) => {
    setSelectedId(r[config.idKey]);
    setForm(config.fromRow(r));
    setErrors({});
  };

  const onNew = () => {
    setSelectedId(null);
    setForm(config.emptyForm);
    setErrors({});
  };

  const onSave = async () => {
    const err = config.validate(form);
    if (err) { setErrors({ [err.field]: err.message }); return; }
    setErrors({});
    setSaving(true);
    try {
      if (selectedId != null) {
        await api.put(`${config.base}/${encodeURIComponent(selectedId)}`, config.toBody(form));
        toast(`${config.singular} updated`);
      } else {
        await api.post(config.base, config.toBody(form));
        toast(`${config.singular} created`);
        onNew();
      }
      await load(q);
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (selectedId == null) return;
    if (!(await confirm({
      title: `Delete ${config.singular.toLowerCase()}?`,
      message: `This ${config.singular.toLowerCase()} will be permanently deleted. This cannot be undone.`,
      confirmText: 'Delete', danger: true,
    }))) return;
    try {
      await api.del(`${config.base}/${encodeURIComponent(selectedId)}`);
      toast(`${config.singular} deleted`);
      onNew();
      await load(q);
    } catch (e) {
      toast(e.message);
    }
  };

  return (
    <div className="split">
      <div className="panel col-list">
        <div className="panelhead">
          {config.title}
          <small style={{ marginLeft: 'auto' }}>{filtered.length} record{filtered.length === 1 ? '' : 's'}</small>
        </div>
        <div className="filterrow">
          <input
            placeholder={`Search ${config.title.toLowerCase()}...`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="scroller">
          {loading ? (
            <Loader />
          ) : filtered.length === 0 ? (
            <Empty text={q ? 'No matches found.' : `No ${config.title.toLowerCase()} yet.`} />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  {config.columns.map((c) => (
                    <th key={c.label} className={c.className === 'num' ? 'num' : undefined}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r[config.idKey]}
                    className={r[config.idKey] === selectedId ? 'sel' : undefined}
                    onClick={() => selectRow(r)}
                  >
                    {config.columns.map((c) => (
                      <td key={c.label} className={c.className}>{c.render(r)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="col-detail">
        <Panel
          title={selectedId != null ? `Edit ${config.singular} — ${selectedId}` : `New ${config.singular}`}
          toolbar={
            <>
              {canEdit && (
                <button className="btn sm" onClick={onNew}>
                  <i className="ti ti-plus" /> New
                </button>
              )}
              {canEdit && (
                <button className="btn sm success" onClick={onSave} disabled={saving}>
                  <i className="ti ti-device-floppy" /> Save
                </button>
              )}
              {config.canDelete && selectedId != null && can('Master Data', 'Delete') && (
                <button className="btn sm danger" onClick={onDelete}>
                  <i className="ti ti-trash" /> Delete
                </button>
              )}
              <button className="btn sm" onClick={() => setHistory(true)} title="Change history">
                <i className="ti ti-history" /> History
              </button>
            </>
          }
        >
          <div className="fgrid">
            {config.fields.map((fld) => (
              <Field key={fld.key} label={fld.label} required={fld.required} error={errors[fld.key]}>
                {fld.type === 'select' ? (
                  <Select
                    value={form[fld.key]} placeholder="— Select —"
                    onChange={(v) => { setForm((f) => ({ ...f, [fld.key]: v })); setErrors((er) => (er[fld.key] ? { ...er, [fld.key]: undefined } : er)); }}
                    options={(options[fld.key] || []).map((o) => ({ value: o[fld.optionValue], label: o[fld.optionLabel] }))}
                  />
                ) : (
                  <input
                    type={fld.type || 'text'}
                    className={fld.className}
                    placeholder={fld.placeholder}
                    value={form[fld.key]}
                    onChange={set(fld.key)}
                  />
                )}
              </Field>
            ))}
          </div>
        </Panel>
      </div>

      {history && (
        <HistoryDrawer
          config={config}
          record={selectedId != null ? rows.find((r) => r[config.idKey] === selectedId) : null}
          onClose={() => setHistory(false)}
        />
      )}
    </div>
  );
}

export default function Masters() {
  const [tab, setTab] = useState('packages');

  return (
    <div>
      <div className="set-tabs" style={{ marginBottom: 14, borderRadius: 14, border: '1px solid var(--line)' }}>
        {TABS.map((t) => (
          <div
            key={t.id}
            className={`set-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <i className={`ti ${t.icon}`} style={{ marginRight: 6 }} />
            {t.label}
          </div>
        ))}
      </div>

      <MasterTab key={tab} config={CONFIGS[tab]} />
    </div>
  );
}
