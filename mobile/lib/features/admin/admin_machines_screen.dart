import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/auth_provider.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'admin_shell.dart';

class AdminMachinesScreen extends StatefulWidget {
  const AdminMachinesScreen({super.key});
  @override
  State<AdminMachinesScreen> createState() => _AdminMachinesScreenState();
}

class _AdminMachinesScreenState extends State<AdminMachinesScreen> {
  List<dynamic> _machines = [];
  bool _isLoading = true;
  String? _error;
  String? _statusFilter;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final params = <String, String>{};
      if (_statusFilter != null) params['status'] = _statusFilter!;
      final res = await context.read<ApiClient>().get('/api/machines', queryParameters: params);
      setState(() {
        _machines = ((res.data as Map)['machines'] as List?)?.cast<dynamic>() ?? [];
        _isLoading = false;
      });
    } catch (e) {
      setState(() { _error = ApiClient.getErrorMessage(e); _isLoading = false; });
    }
  }

  String _timeAgo(String? iso) {
    if (iso == null) return '-';
    try {
      final dt = DateTime.parse(iso);
      final diff = DateTime.now().difference(dt);
      if (diff.inDays > 0) return '${diff.inDays}h lalu';
      if (diff.inHours > 0) return '${diff.inHours}j lalu';
      if (diff.inMinutes > 0) return '${diff.inMinutes}m lalu';
      return 'baru saja';
    } catch (_) {
      return '-';
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final isSuperadmin = auth.hasRole(AppRole.SUPERADMIN);
    return Stack(children: [
      AdminShell(title: 'Mesin', child: Column(children: [
        _buildFilterChips(),
        Expanded(child: RefreshIndicator(onRefresh: _load, child: _buildBody())),
      ])),
      if (isSuperadmin)
        Positioned(
          right: 16,
          bottom: 18,
          child: FloatingActionButton.extended(
            onPressed: _showAddMachineSheet,
            backgroundColor: context.reloopBrandText,
            foregroundColor: context.reloopSurface,
            elevation: 4,
            icon: const Icon(Icons.add, size: 20),
            label: const Text('Tambah Mesin', style: TextStyle(fontWeight: FontWeight.w700)),
          ),
        ),
    ]);
  }

  Widget _buildFilterChips() {
    const statuses = ['ONLINE', 'FULL', 'MAINTENANCE', 'ERROR', 'OFFLINE'];
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
        FilterChip(label: const Text('Semua'), selected: _statusFilter == null, onSelected: (_) { setState(() => _statusFilter = null); _load(); }),
        const SizedBox(width: 6),
        ...statuses.map((s) => Padding(padding: const EdgeInsets.only(right: 6), child: FilterChip(
          label: Text(_statusLabel(s)), selectedColor: context.reloopBrandSoft,
          selected: _statusFilter == s, onSelected: (_) { setState(() => _statusFilter = _statusFilter == s ? null : s); _load(); },
        ))),
      ])),
    );
  }

  Widget _buildBody() {
    if (_isLoading) return ListView(padding: const EdgeInsets.all(16), children: const [SkeletonListTile(), SizedBox(height: 8), SkeletonListTile()]);
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.cloud_off, size: 48, color: context.reloopMutedSoft), const SizedBox(height: 12),
        Text(_error ?? '', style: TextStyle(color: context.reloopMuted)),
        TextButton(onPressed: _load, child: const Text('Coba Lagi')),
      ]));
    }
    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      itemCount: _machines.length + 1,
      itemBuilder: (_, i) {
        if (i == 0) {
          final auth = context.watch<AuthProvider>();
          final isSuperadmin = auth.hasRole(AppRole.SUPERADMIN);
          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: context.reloopBrandSoft,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: context.reloopBrandText.withValues(alpha: 0.18)),
              ),
              child: Row(children: [
                Icon(Icons.info_outline, size: 16, color: context.reloopBrandText),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    isSuperadmin
                        ? 'Anda memiliki akses penuh untuk menambah dan mengelola semua mesin.'
                        : 'Mesin ditambahkan oleh Superadmin. Hubungi Superadmin untuk menambah mesin baru.',
                    style: TextStyle(fontSize: 11, color: context.reloopBrandText),
                  ),
                ),
              ]),
            ),
          );
        }
        return _buildCard(_machines[i - 1]);
      },
    );
  }

  Widget _buildCard(dynamic m) {
    final machine = m as Map<String, dynamic>;
    final org = machine['organization'] as Map<String, dynamic>?;
    final fillLevel = (machine['fillLevelPercent'] as num?)?.toInt() ?? 0;
    final status = (machine['status'] as String?) ?? 'OFFLINE';
    final code = machine['machineCode'] as String? ?? '';
    final heartbeat = machine['lastHeartbeatAt'] as String?;

    final fillColor = fillLevel >= 80 ? ReLoopColors.statusFull : fillLevel >= 50 ? ReLoopColors.statusFull.withValues(alpha: 0.7) : ReLoopColors.brand500;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: ReLoopCard(
        child: InkWell(
          onTap: () {
            final id = machine['id'] as String?;
            if (id != null) {
              final auth = context.read<AuthProvider>();
              if (auth.user?.role == AppRole.SUPERADMIN) {
                context.push('/superadmin/machines/$id/detail');
              } else {
                context.push('/admin/machines/$id/detail');
              }
            }
          },
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.all(2),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text((machine['name'] as String?) ?? 'Mesin', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: context.reloopForeground))),
                    if (code.isNotEmpty) Icon(Icons.chevron_right, size: 18, color: context.reloopMutedSoft),
                  ]),
                  const SizedBox(height: 2),
                  Text(code, style: TextStyle(fontSize: 12, color: context.reloopMutedSoft)),
                ])),
                StatusBadge(statusKey: status),
              ]),
              if (org != null) Text(org['name'] as String? ?? '', style: TextStyle(fontSize: 11, color: context.reloopMutedSoft)),
              const SizedBox(height: 8),
              // Fill level bar
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: fillLevel / 100,
                  minHeight: 6,
                  backgroundColor: context.reloopBorder,
                  valueColor: AlwaysStoppedAnimation<Color>(fillColor),
                ),
              ),
              const SizedBox(height: 4),
              Row(children: [
                Text('$fillLevel% terisi', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: fillColor)),
                const Spacer(),
                if (heartbeat != null)
                  Text('Heartbeat ${_timeAgo(heartbeat)}', style: TextStyle(fontSize: 10, color: context.reloopMutedSoft)),
              ]),
            ]),
          ),
        ),
      ),
    );
  }

  Future<void> _showAddMachineSheet() async {
    final created = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: context.reloopSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetCtx) => const _AddMachineSheet(),
    );
    if (created != null) {
      setState(() => _machines.insert(0, created));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Mesin "${created['name'] ?? ''}" berhasil didaftarkan'),
            backgroundColor: ReLoopColors.brand600,
          ),
        );
      }
    }
  }

  String _statusLabel(String s) {
    switch (s) {
      case 'ONLINE': return 'Online';
      case 'FULL': return 'Penuh';
      case 'MAINTENANCE': return 'Mtce';
      case 'ERROR': return 'Error';
      case 'OFFLINE': return 'Offline';
      default: return s;
    }
  }
}

class _AddMachineSheet extends StatefulWidget {
  const _AddMachineSheet();

  @override
  State<_AddMachineSheet> createState() => _AddMachineSheetState();
}

class _AddMachineSheetState extends State<_AddMachineSheet> {
  final _formKey = GlobalKey<FormState>();
  final _codeCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _capacityCtrl = TextEditingController();
  String? _orgId;
  String? _regionId;
  bool _isSaving = false;
  String? _error;

  List<Map<String, dynamic>> _orgs = const [];
  List<Map<String, dynamic>> _regions = const [];
  bool _loadingLists = true;

  @override
  void initState() {
    super.initState();
    _loadLists();
  }

  @override
  void dispose() {
    _codeCtrl.dispose();
    _nameCtrl.dispose();
    _descCtrl.dispose();
    _capacityCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadLists() async {
    try {
      final api = context.read<ApiClient>();
      final orgsRes = await api.get('/api/organizations');
      final orgsList = (orgsRes.data is Map && (orgsRes.data as Map)['organizations'] is List)
          ? List<Map<String, dynamic>>.from((orgsRes.data as Map)['organizations'] as List)
          : <Map<String, dynamic>>[];
      List<Map<String, dynamic>> regionsList = const [];
      try {
        final regRes = await api.get('/api/regions');
        if (regRes.data is Map && (regRes.data as Map)['regions'] is List) {
          regionsList = List<Map<String, dynamic>>.from(
            (regRes.data as Map)['regions'] as List,
          );
        }
      } catch (_) {
        // Region list is optional; superadmin screens may not need it.
      }
      if (!mounted) return;
      setState(() {
        _orgs = orgsList;
        _regions = regionsList;
        _loadingLists = false;
        if (orgsList.isNotEmpty && _orgId == null) {
          _orgId = orgsList.first['id'] as String?;
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingLists = false;
        _error = 'Gagal memuat daftar: ${e.toString()}';
      });
    }
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_orgId == null) {
      setState(() => _error = 'Pilih organisasi terlebih dahulu');
      return;
    }
    setState(() {
      _isSaving = true;
      _error = null;
    });
    try {
      final api = context.read<ApiClient>();
      final payload = <String, dynamic>{
        'machineCode': _codeCtrl.text.trim(),
        'name': _nameCtrl.text.trim(),
        'organizationId': _orgId,
        'status': 'OFFLINE',
      };
      if (_descCtrl.text.trim().isNotEmpty) {
        payload['description'] = _descCtrl.text.trim();
      }
      if (_regionId != null) payload['regionId'] = _regionId;
      if (_capacityCtrl.text.trim().isNotEmpty) {
        final cap = double.tryParse(_capacityCtrl.text.trim());
        if (cap != null) payload['capacityKg'] = cap;
      }
      final res = await api.post('/api/machines', data: payload);
      final machine = (res.data is Map && (res.data as Map)['machine'] is Map)
          ? Map<String, dynamic>.from((res.data as Map)['machine'] as Map)
          : <String, dynamic>{};
      if (!mounted) return;
      Navigator.of(context).pop(machine);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isSaving = false;
        _error = 'Gagal mendaftarkan mesin: ${e.toString()}';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final inset = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: inset),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    margin: const EdgeInsets.only(bottom: 12),
                    decoration: BoxDecoration(
                      color: context.reloopBorder,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                Row(children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: context.reloopBrandSoft,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(Icons.add_business_outlined, color: context.reloopBrandText, size: 20),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Tambah Mesin',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                            color: context.reloopForeground,
                            letterSpacing: -0.3,
                          ),
                        ),
                        Text(
                          'Daftarkan unit RVM baru ke organisasi',
                          style: TextStyle(fontSize: 12, color: context.reloopMuted),
                        ),
                      ],
                    ),
                  ),
                ]),
                const SizedBox(height: 18),
                TextFormField(
                  controller: _codeCtrl,
                  decoration: _inputDecoration(context, 'Kode mesin', hint: 'Contoh: RVM-JKT-001'),
                  textCapitalization: TextCapitalization.characters,
                  validator: (v) {
                    final value = v?.trim() ?? '';
                    if (value.length < 2) return 'Minimal 2 karakter';
                    if (value.length > 40) return 'Maksimal 40 karakter';
                    if (!RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(value)) {
                      return 'Hanya huruf, angka, - dan _';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _nameCtrl,
                  decoration: _inputDecoration(context, 'Nama mesin', hint: 'Contoh: RVM Pasar Minggu'),
                  textCapitalization: TextCapitalization.words,
                  validator: (v) {
                    final value = v?.trim() ?? '';
                    if (value.length < 2) return 'Minimal 2 karakter';
                    if (value.length > 120) return 'Maksimal 120 karakter';
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                _loadingLists
                    ? Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Center(
                          child: SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.4,
                              color: context.reloopBrandText,
                            ),
                          ),
                        ),
                      )
                    : _OrgDropdown(
                        orgs: _orgs,
                        value: _orgId,
                        onChanged: (v) => setState(() => _orgId = v),
                      ),
                if (_regions.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _RegionDropdown(
                    regions: _regions,
                    value: _regionId,
                    onChanged: (v) => setState(() => _regionId = v),
                  ),
                ],
                const SizedBox(height: 12),
                TextFormField(
                  controller: _capacityCtrl,
                  decoration: _inputDecoration(context, 'Kapasitas (kg)', hint: 'Opsional, mis. 50'),
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) return null;
                    final n = double.tryParse(v.trim());
                    if (n == null || n <= 0) return 'Harus angka positif';
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _descCtrl,
                  decoration: _inputDecoration(context, 'Catatan', hint: 'Opsional, lokasi penempatan, dll.'),
                  maxLines: 3,
                  maxLength: 500,
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: ReLoopColors.danger.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: ReLoopColors.danger.withValues(alpha: 0.4)),
                    ),
                    child: Text(
                      _error!,
                      style: const TextStyle(fontSize: 12, color: ReLoopColors.danger, fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                Row(children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _isSaving ? null : () => Navigator.of(context).pop(),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: context.reloopForeground,
                        side: BorderSide(color: context.reloopBorder),
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: const Text('Batal', style: TextStyle(fontWeight: FontWeight.w700)),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      onPressed: _isSaving || _loadingLists ? null : _submit,
                      style: FilledButton.styleFrom(
                        backgroundColor: context.reloopBrandText,
                        foregroundColor: context.reloopSurface,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: _isSaving
                          ? SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.4,
                                color: context.reloopSurface,
                              ),
                            )
                          : const Text('Daftarkan', style: TextStyle(fontWeight: FontWeight.w800)),
                    ),
                  ),
                ]),
              ],
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration _inputDecoration(BuildContext context, String label, {String? hint}) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      filled: true,
      fillColor: context.reloopSurface,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: context.reloopBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: context.reloopBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: context.reloopBrandText, width: 1.4),
      ),
    );
  }
}

class _OrgDropdown extends StatelessWidget {
  const _OrgDropdown({required this.orgs, required this.value, required this.onChanged});

  final List<Map<String, dynamic>> orgs;
  final String? value;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: 'Organisasi',
        filled: true,
        fillColor: context.reloopSurface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: context.reloopBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: context.reloopBorder),
        ),
      ),
      dropdownColor: context.reloopSurface,
      items: orgs
          .map((o) => DropdownMenuItem<String>(
                value: o['id'] as String?,
                child: Text((o['name'] as String?) ?? '-',
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: context.reloopForeground)),
              ))
          .toList(),
      onChanged: onChanged,
      validator: (v) => v == null ? 'Pilih organisasi' : null,
    );
  }
}

class _RegionDropdown extends StatelessWidget {
  const _RegionDropdown({required this.regions, required this.value, required this.onChanged});

  final List<Map<String, dynamic>> regions;
  final String? value;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: 'Wilayah (opsional)',
        filled: true,
        fillColor: context.reloopSurface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: context.reloopBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: context.reloopBorder),
        ),
      ),
      dropdownColor: context.reloopSurface,
      items: [
        const DropdownMenuItem<String>(value: null, child: Text('Tanpa wilayah')),
        ...regions.map((r) => DropdownMenuItem<String>(
              value: r['id'] as String?,
              child: Text((r['name'] as String?) ?? '-',
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: context.reloopForeground)),
            )),
      ],
      onChanged: onChanged,
    );
  }
}
