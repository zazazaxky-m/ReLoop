import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/filter_chips.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/search_bar.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../shared/widgets/status_badge.dart';
import '../../theme/colors.dart';
import '../admin/admin_shell.dart';

/// Layar khusus superadmin untuk mengelola organisasi.
/// Menampilkan 3 metric (aktif, total, suspended), create/edit form,
/// serta aksi suspend/activate inline.
class SuperadminOrganizationsScreen extends StatefulWidget {
  const SuperadminOrganizationsScreen({super.key});

  @override
  State<SuperadminOrganizationsScreen> createState() =>
      _SuperadminOrganizationsScreenState();
}

class _SuperadminOrganizationsScreenState
    extends State<SuperadminOrganizationsScreen> {
  List<dynamic> _rows = [];
  List<dynamic> _regions = [];
  String? _error;
  String _query = '';
  String? _statusFilter;
  bool _loading = true;

  static const _statusOptions = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = context.read<ApiClient>();
      final res = await api.get('/api/organizations');
      List<dynamic> regions = const [];
      try {
        final r = await api.get('/api/regions');
        regions = (r.data['regions'] as List?) ?? [];
      } catch (_) {}
      if (mounted) {
        setState(() {
          _rows = (res.data['organizations'] as List?) ?? [];
          _regions = regions;
          _loading = false;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = ApiClient.getErrorMessage(error);
          _loading = false;
        });
      }
    }
  }

  Future<void> _save(Map<String, dynamic> data, [String? id]) async {
    try {
      final api = context.read<ApiClient>();
      if (id == null) {
        await api.post('/api/organizations', data: data);
      } else {
        await api.patch('/api/organizations/$id', data: data);
      }
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(id == null ? 'Organisasi dibuat' : 'Perubahan disimpan'),
            backgroundColor: ReLoopColors.success,
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(ApiClient.getErrorMessage(error)),
            backgroundColor: ReLoopColors.danger,
          ),
        );
      }
    }
  }

  void _showCreate() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => _OrganizationForm(
        regions: _regions,
        onSubmit: (data) => _save(data),
      ),
    );
  }

  void _showEdit(Map<String, dynamic> org) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => _OrganizationForm(
        regions: _regions,
        initial: org,
        onSubmit: (data) => _save(data, org['id']),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final active = _rows.where((r) => r['status'] == 'ACTIVE').length;
    final suspended = _rows.where((r) => r['status'] == 'SUSPENDED').length;
    final filtered = _rows.where((row) {
      final r = row as Map<String, dynamic>;
      if (_statusFilter != null && r['status'] != _statusFilter) return false;
      if (_query.isEmpty) return true;
      final q = _query.toLowerCase();
      return (r['name']?.toString().toLowerCase().contains(q) ?? false) ||
          (r['address']?.toString().toLowerCase().contains(q) ?? false);
    }).toList();

    return AdminShell(
      title: 'Organisasi',
      actions: [IconButton(icon: const Icon(Icons.add), onPressed: _showCreate)],
      child: RefreshIndicator(
        onRefresh: _load,
        child: _body(filtered, active, suspended),
      ),
    );
  }

  Widget _body(List<dynamic> rows, int active, int suspended) {
    if (_loading) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 100),
        children: const [
          SkeletonListTile(),
          SizedBox(height: 10),
          SkeletonListTile(),
          SizedBox(height: 10),
          SkeletonListTile(),
        ],
      );
    }
    if (_error != null) {
      return _ErrorState(message: _error!, onRetry: _load);
    }
    return CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          sliver: SliverToBoxAdapter(
            child: Row(
              children: [
                Expanded(
                  child: MetricCard(
                    label: 'Aktif',
                    value: '$active',
                    icon: Icons.verified_outlined,
                    tone: MetricTone.green,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: MetricCard(
                    label: 'Total',
                    value: '${_rows.length}',
                    icon: Icons.business_outlined,
                    tone: MetricTone.blue,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: MetricCard(
                    label: 'Suspended',
                    value: '$suspended',
                    icon: Icons.pause_circle_outline,
                    tone: MetricTone.amber,
                  ),
                ),
              ],
            ),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          sliver: SliverToBoxAdapter(
            child: ReLoopSearchBar(
              hintText: 'Cari organisasi...',
              onChanged: (v) => setState(() => _query = v),
            ),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          sliver: SliverToBoxAdapter(
            child: ReLoopFilterChips(
              label: 'Status',
              options: _statusOptions,
              selected: _statusFilter,
              onSelected: (v) => setState(() => _statusFilter = v),
            ),
          ),
        ),
        if (rows.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.business_outlined,
              title: 'Belum ada organisasi',
              description: _query.isNotEmpty || _statusFilter != null
                  ? 'Coba ubah pencarian atau filter.'
                  : 'Tambahkan organisasi baru dengan tombol + di kanan atas.',
            ),
          )
        else
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 100),
            sliver: SliverList.builder(
              itemCount: rows.length,
              itemBuilder: (context, index) {
                final raw = rows[index] as Map<String, dynamic>;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _OrganizationCard(
                    row: raw,
                    onEdit: () => _showEdit(raw),
                    onStatusChange: (newStatus) => _save(
                      {'status': newStatus},
                      raw['id'],
                    ),
                  ),
                );
              },
            ),
          ),
      ],
    );
  }
}

class _OrganizationCard extends StatelessWidget {
  const _OrganizationCard({
    required this.row,
    required this.onEdit,
    required this.onStatusChange,
  });

  final Map<String, dynamic> row;
  final VoidCallback onEdit;
  final ValueChanged<String> onStatusChange;

  @override
  Widget build(BuildContext context) {
    final status = (row['status'] as String?) ?? 'ACTIVE';
    final type = row['type']?.toString();
    final region = row['region'] as Map<String, dynamic>?;
    final machineCount = (row['_count']?['machines'] as num?)?.toInt() ?? 0;
    final userCount = (row['_count']?['users'] as num?)?.toInt() ?? 0;

    return ReLoopCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: context.reloopBrandSoft,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(
                  Icons.business_outlined,
                  color: context.reloopBrandText,
                  size: 19,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      row['name']?.toString() ?? '-',
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 13.5,
                      ),
                    ),
                    if (type != null)
                      Text(
                        '${_typeLabel(type)}${region != null ? ' · ${region['name']}' : ''}',
                        style: TextStyle(
                          fontSize: 11.5,
                          color: context.reloopMuted,
                        ),
                      ),
                  ],
                ),
              ),
              StatusBadge(statusKey: status),
            ],
          ),
          if (row['address'] != null && row['address'].toString().isNotEmpty) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(
                  Icons.location_on_outlined,
                  size: 13,
                  color: context.reloopMutedSoft,
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    row['address'].toString(),
                    style: TextStyle(
                      fontSize: 11.5,
                      color: context.reloopMutedSoft,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: [
              _StatChip(
                icon: Icons.recycling_outlined,
                label: '$machineCount mesin',
              ),
              const SizedBox(width: 6),
              _StatChip(
                icon: Icons.people_outline,
                label: '$userCount pengguna',
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            alignment: WrapAlignment.end,
            children: [
              OutlinedButton(
                style: _buttonStyle(context, danger: false),
                onPressed: onEdit,
                child: const Text(
                  'Edit',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                ),
              ),
              if (status == 'ACTIVE')
                OutlinedButton(
                  style: _buttonStyle(context, danger: true),
                  onPressed: () => onStatusChange('SUSPENDED'),
                  child: const Text(
                    'Suspend',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                  ),
                )
              else
                OutlinedButton(
                  style: _buttonStyle(context, danger: false),
                  onPressed: () => onStatusChange('ACTIVE'),
                  child: const Text(
                    'Aktifkan',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  ButtonStyle _buttonStyle(BuildContext context, {required bool danger}) {
    return OutlinedButton.styleFrom(
      foregroundColor: danger ? ReLoopColors.danger : context.reloopBrandText,
      side: BorderSide(
        color: danger
            ? ReLoopColors.danger.withValues(alpha: .5)
            : context.reloopBrandText.withValues(alpha: .4),
      ),
      minimumSize: const Size(0, 32),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
    );
  }

  String _typeLabel(String type) {
    switch (type) {
      case 'SCHOOL':
        return 'Sekolah';
      case 'CAMPUS':
        return 'Kampus';
      case 'VILLAGE':
        return 'Desa';
      case 'TOURISM_SITE':
        return 'Lokasi wisata';
      case 'OFFICE':
        return 'Kantor';
      case 'COMMUNITY':
        return 'Komunitas';
      case 'WASTE_BANK':
        return 'Bank sampah';
      default:
        return 'Lainnya';
    }
  }
}

class _StatChip extends StatelessWidget {
  const _StatChip({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: context.reloopSurface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: context.reloopBorder),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: context.reloopMuted),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(fontSize: 11, color: context.reloopMuted),
          ),
        ],
      ),
    );
  }
}

class _OrganizationForm extends StatefulWidget {
  const _OrganizationForm({
    required this.regions,
    required this.onSubmit,
    this.initial,
  });

  final List<dynamic> regions;
  final Map<String, dynamic>? initial;
  final ValueChanged<Map<String, dynamic>> onSubmit;

  @override
  State<_OrganizationForm> createState() => _OrganizationFormState();
}

class _OrganizationFormState extends State<_OrganizationForm> {
  late final TextEditingController _name;
  late final TextEditingController _address;
  late final TextEditingController _contactName;
  late final TextEditingController _contactPhone;
  String _type = 'OTHER';
  String? _regionId;
  String _status = 'ACTIVE';
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final i = widget.initial ?? const {};
    _name = TextEditingController(text: i['name']?.toString() ?? '');
    _address = TextEditingController(text: i['address']?.toString() ?? '');
    _contactName = TextEditingController(
      text: i['contactName']?.toString() ?? '',
    );
    _contactPhone = TextEditingController(
      text: i['contactPhone']?.toString() ?? '',
    );
    _type = (i['type'] as String?) ?? 'OTHER';
    _regionId = (i['regionId'] as String?) ?? (i['region']?['id'] as String?);
    _status = (i['status'] as String?) ?? 'ACTIVE';
  }

  @override
  void dispose() {
    _name.dispose();
    _address.dispose();
    _contactName.dispose();
    _contactPhone.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_name.text.trim().length < 2) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Nama minimal 2 karakter.')),
      );
      return;
    }
    setState(() => _saving = true);
    widget.onSubmit({
      'name': _name.text.trim(),
      'type': _type,
      'regionId': _regionId,
      'address': _address.text.trim().isEmpty ? null : _address.text.trim(),
      'contactName': _contactName.text.trim().isEmpty
          ? null
          : _contactName.text.trim(),
      'contactPhone': _contactPhone.text.trim().isEmpty
          ? null
          : _contactPhone.text.trim(),
      'status': _status,
    });
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.initial != null;
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                alignment: Alignment.center,
                child: Container(
                  width: 38,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.grey.shade300,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Text(
                isEdit ? 'Edit organisasi' : 'Tambah organisasi',
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 16,
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _name,
                decoration: const InputDecoration(
                  labelText: 'Nama organisasi',
                ),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _type,
                decoration: const InputDecoration(labelText: 'Tipe'),
                items: const [
                  DropdownMenuItem(value: 'SCHOOL', child: Text('Sekolah')),
                  DropdownMenuItem(value: 'CAMPUS', child: Text('Kampus')),
                  DropdownMenuItem(value: 'VILLAGE', child: Text('Desa')),
                  DropdownMenuItem(
                    value: 'TOURISM_SITE',
                    child: Text('Lokasi wisata'),
                  ),
                  DropdownMenuItem(value: 'OFFICE', child: Text('Kantor')),
                  DropdownMenuItem(
                    value: 'COMMUNITY',
                    child: Text('Komunitas'),
                  ),
                  DropdownMenuItem(
                    value: 'WASTE_BANK',
                    child: Text('Bank sampah'),
                  ),
                  DropdownMenuItem(value: 'OTHER', child: Text('Lainnya')),
                ],
                onChanged: (v) => setState(() => _type = v ?? 'OTHER'),
              ),
              const SizedBox(height: 12),
              if (widget.regions.isNotEmpty)
                DropdownButtonFormField<String?>(
                  initialValue: _regionId,
                  decoration: const InputDecoration(labelText: 'Wilayah'),
                  items: [
                    const DropdownMenuItem(value: null, child: Text('Tidak ada')),
                    for (final r in widget.regions)
                      DropdownMenuItem(
                        value: r['id'] as String?,
                        child: Text(r['name']?.toString() ?? '-'),
                      ),
                  ],
                  onChanged: (v) => setState(() => _regionId = v),
                ),
              const SizedBox(height: 12),
              TextField(
                controller: _address,
                decoration: const InputDecoration(labelText: 'Alamat (opsional)'),
                maxLines: 2,
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _contactName,
                decoration: const InputDecoration(
                  labelText: 'Nama kontak (opsional)',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _contactPhone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                  labelText: 'Telepon kontak (opsional)',
                ),
              ),
              if (isEdit) ...[
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: _status,
                  decoration: const InputDecoration(labelText: 'Status'),
                  items: const [
                    DropdownMenuItem(value: 'ACTIVE', child: Text('Aktif')),
                    DropdownMenuItem(
                      value: 'INACTIVE',
                      child: Text('Nonaktif'),
                    ),
                    DropdownMenuItem(
                      value: 'SUSPENDED',
                      child: Text('Suspended'),
                    ),
                  ],
                  onChanged: (v) => setState(() => _status = v ?? 'ACTIVE'),
                ),
              ],
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: _saving ? null : _submit,
                icon: const Icon(Icons.check_rounded),
                label: Text(isEdit ? 'Simpan perubahan' : 'Buat organisasi'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 120),
        Icon(
          Icons.cloud_off_rounded,
          size: 48,
          color: context.reloopMutedSoft,
        ),
        const SizedBox(height: 12),
        Text(
          message,
          textAlign: TextAlign.center,
          style: TextStyle(color: context.reloopMuted),
        ),
        const SizedBox(height: 8),
        Center(
          child: TextButton(onPressed: onRetry, child: Text('Coba lagi')),
        ),
      ],
    );
  }
}
