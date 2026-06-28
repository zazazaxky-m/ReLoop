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
    return AdminShell(title: 'Mesin', child: Column(children: [
      _buildFilterChips(),
      Expanded(child: RefreshIndicator(onRefresh: _load, child: _buildBody())),
    ]));
  }

  Widget _buildFilterChips() {
    const statuses = ['ONLINE', 'FULL', 'MAINTENANCE', 'ERROR', 'OFFLINE'];
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
        FilterChip(label: const Text('Semua'), selected: _statusFilter == null, onSelected: (_) { setState(() => _statusFilter = null); _load(); }),
        const SizedBox(width: 6),
        ...statuses.map((s) => Padding(padding: const EdgeInsets.only(right: 6), child: FilterChip(
          label: Text(_statusLabel(s)), selectedColor: ReLoopColors.brand50,
          selected: _statusFilter == s, onSelected: (_) { setState(() => _statusFilter = _statusFilter == s ? null : s); _load(); },
        ))),
      ])),
    );
  }

  Widget _buildBody() {
    if (_isLoading) return ListView(padding: const EdgeInsets.all(16), children: const [SkeletonListTile(), SizedBox(height: 8), SkeletonListTile()]);
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.cloud_off, size: 48, color: ReLoopColors.mutedSoft), const SizedBox(height: 12),
        Text(_error ?? '', style: const TextStyle(color: ReLoopColors.muted)),
        TextButton(onPressed: _load, child: const Text('Coba Lagi')),
      ]));
    }
    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      itemCount: _machines.length + 1,
      itemBuilder: (_, i) {
        if (i == 0) {
          return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: ReLoopColors.brand50, borderRadius: BorderRadius.circular(8)),
            child: const Row(children: [
              Icon(Icons.info_outline, size: 16, color: ReLoopColors.brand600),
              SizedBox(width: 8),
              Expanded(child: Text('Mesin ditambahkan oleh Superadmin. Hubungi Superadmin untuk menambah mesin baru.', style: TextStyle(fontSize: 11, color: ReLoopColors.brand700))),
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
                    Expanded(child: Text((machine['name'] as String?) ?? 'Mesin', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: ReLoopColors.foreground))),
                    if (code.isNotEmpty) const Icon(Icons.chevron_right, size: 18, color: ReLoopColors.mutedSoft),
                  ]),
                  const SizedBox(height: 2),
                  Text(code, style: const TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft)),
                ])),
                StatusBadge(statusKey: status),
              ]),
              if (org != null) Text(org['name'] as String? ?? '', style: const TextStyle(fontSize: 11, color: ReLoopColors.mutedSoft)),
              const SizedBox(height: 8),
              // Fill level bar
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: fillLevel / 100,
                  minHeight: 6,
                  backgroundColor: ReLoopColors.border,
                  valueColor: AlwaysStoppedAnimation<Color>(fillColor),
                ),
              ),
              const SizedBox(height: 4),
              Row(children: [
                Text('$fillLevel% terisi', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: fillColor)),
                const Spacer(),
                if (heartbeat != null)
                  Text('Heartbeat ${_timeAgo(heartbeat)}', style: const TextStyle(fontSize: 10, color: ReLoopColors.mutedSoft)),
              ]),
            ]),
          ),
        ),
      ),
    );
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
