import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/auth_provider.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';

class AdminMachineDetailScreen extends StatefulWidget {
  final String machineId;

  const AdminMachineDetailScreen({super.key, required this.machineId});

  @override
  State<AdminMachineDetailScreen> createState() => _AdminMachineDetailScreenState();
}

class _AdminMachineDetailScreenState extends State<AdminMachineDetailScreen> {
  Map<String, dynamic>? _machine;
  List<dynamic> _sessions = [];
  List<dynamic> _securityEvents = [];
  List<dynamic> _remoteCommands = [];
  bool _isLoading = true;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadMachine();
  }

  Future<void> _loadMachine() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final api = context.read<ApiClient>();
      final auth = context.read<AuthProvider>();
      final response = await api.get('/api/machines/${widget.machineId}');
      final data = response.data as Map<String, dynamic>;
      final machine = data['machine'] as Map<String, dynamic>;

      // Superadmin gets the extra surfaces: security events and remote commands.
      List<dynamic> securityEvents = const [];
      List<dynamic> remoteCommands = const [];
      if (auth.user?.role == AppRole.SUPERADMIN) {
        try {
          final auditRes = await api.get(
            '/api/mobile/audit-security',
            queryParameters: {'machineId': widget.machineId},
          );
          final auditData = auditRes.data as Map<String, dynamic>;
          securityEvents =
              (auditData['securityEvents'] as List?)?.cast<dynamic>() ?? const [];
        } catch (_) {}
        try {
          final cmdRes = await api.get('/api/machines/${widget.machineId}/remote-commands');
          final cmdData = cmdRes.data as Map<String, dynamic>;
          remoteCommands =
              (cmdData['commands'] as List?)?.cast<dynamic>() ?? const [];
        } catch (_) {}
      }

      setState(() {
        _machine = machine;
        _sessions = (machine['sessions'] as List? ?? []);
        _securityEvents = securityEvents;
        _remoteCommands = remoteCommands;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = ApiClient.getErrorMessage(e);
        _isLoading = false;
      });
    }
  }

  Future<void> _updateMachine(Map<String, dynamic> body) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await context
          .read<ApiClient>()
          .patch('/api/machines/${widget.machineId}', data: body);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Mesin diperbarui'),
          backgroundColor: ReLoopColors.success,
        ),
      );
      await _loadMachine();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(ApiClient.getErrorMessage(e)),
          backgroundColor: ReLoopColors.danger,
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _changeStatus(String status) async {
    await _updateMachine({'status': status});
  }

  Future<void> _rotateSecret() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Rotasi ingest secret?'),
        content: const Text(
          'Secret baru akan ditampilkan sekali. Perangkat harus dikonfigurasi ulang.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Batal'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Lanjutkan'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    setState(() => _busy = true);
    try {
      final res = await context
          .read<ApiClient>()
          .post('/api/machines/${widget.machineId}/rotate-secret');
      final data = res.data as Map<String, dynamic>;
      final secret = (data['ingestSecret'] as String?) ?? '';
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Ingest Secret Baru'),
          content: SelectableText(secret),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Tutup'),
            ),
          ],
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(ApiClient.getErrorMessage(e)),
          backgroundColor: ReLoopColors.danger,
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _deleteMachine() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Hapus mesin?'),
        content: const Text(
          'Penghapusan hanya berhasil jika mesin belum memiliki riwayat.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Batal'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: ReLoopColors.danger),
            child: const Text('Hapus'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await context
          .read<ApiClient>()
          .delete('/api/machines/${widget.machineId}');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Mesin dihapus'),
          backgroundColor: ReLoopColors.success,
        ),
      );
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(ApiClient.getErrorMessage(e)),
          backgroundColor: ReLoopColors.danger,
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _formatDate(String iso) {
    try {
      final dt = DateTime.parse(iso);
      return '${dt.day}/${dt.month}/${dt.year} ${dt.hour}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = _machine?['name'] as String? ?? 'Mesin';
    return Scaffold(
      appBar: AppBar(
        title: Text(name),
      ),
      body: RefreshIndicator(
        onRefresh: _loadMachine,
        child: _isLoading
            ? const SkeletonDashboard()
            : _error != null
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.cloud_off, size: 48, color: ReLoopColors.mutedSoft),
                        const SizedBox(height: 12),
                        Text(_error!, style: TextStyle(color: context.reloopMuted)),
                        const SizedBox(height: 12),
                        TextButton(onPressed: _loadMachine, child: const Text('Coba Lagi')),
                      ],
                    ),
                  )
                : ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _buildStatusCard(),
                      const SizedBox(height: 16),
                      _buildControlsCard(),
                      const SizedBox(height: 16),
                      _buildHardwareConfigCard(),
                      const SizedBox(height: 16),
                      _buildInfoCard(),
                      const SizedBox(height: 16),
                      _buildWasteTypesCard(),
                      const SizedBox(height: 16),
                      _buildSessionsCard(),
                      if (_securityEvents.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        _buildSecurityCard(),
                      ],
                      if (_remoteCommands.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        _buildRemoteCommandsCard(),
                      ],
                      const SizedBox(height: 80),
                    ],
                  ),
      ),
    );
  }

  Widget _buildStatusCard() {
    final m = _machine!;
    final status = (m['status'] as String?) ?? 'OFFLINE';
    final fillLevel = (m['fillLevelPercent'] as num?)?.toInt() ?? 0;
    final code = (m['machineCode'] as String?) ?? '';

    Color statusColor;
    switch (status) {
      case 'ONLINE': statusColor = ReLoopColors.statusOnline; break;
      case 'FULL': statusColor = ReLoopColors.statusFull; break;
      case 'ERROR': statusColor = ReLoopColors.statusError; break;
      case 'MAINTENANCE': statusColor = ReLoopColors.statusMaintenance; break;
      default: statusColor = ReLoopColors.statusOffline;
    }

    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: statusColor.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: statusColor.withValues(alpha: 0.3)),
      ),
      child: Column(
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: statusColor,
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.recycling, color: Colors.white, size: 32),
          ),
          const SizedBox(height: 12),
          Text(
            m['name'] as String? ?? 'Mesin',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: statusColor,
            ),
          ),
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              StatusBadge(statusKey: status),
              const SizedBox(width: 8),
              Text(
                'Kode: $code',
                style: TextStyle(
                  color: context.reloopMuted,
                  fontSize: 13,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: fillLevel / 100,
              minHeight: 10,
              backgroundColor: Colors.white.withValues(alpha: 0.3),
              valueColor: AlwaysStoppedAnimation<Color>(statusColor),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Kapasitas Terisi: $fillLevel%',
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }

  Widget _buildHardwareConfigCard() {
    final m = _machine!;
    final hasChamber = m['hasInputChamber'] as bool? ?? false;
    final hasConveyor = m['hasConveyor'] as bool? ?? false;
    final hasCompactor = m['hasCompactor'] as bool? ?? false;
    final hasCamera = m['hasExternalCamera'] as bool? ?? false;

    return ReLoopCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const ReLoopCardTitle(title: 'Konfigurasi Hardware'),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _hwStatusItem('Chamber', hasChamber, Icons.inbox_outlined),
              _hwStatusItem('Conveyor', hasConveyor, Icons.view_timeline_outlined),
              _hwStatusItem('Compactor', hasCompactor, Icons.compress),
              _hwStatusItem('Kamera', hasCamera, Icons.videocam_outlined),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildControlsCard() {
    final auth = context.watch<AuthProvider>();
    final isSuperadmin = auth.user?.role == AppRole.SUPERADMIN;
    final currentStatus = (_machine!['status'] as String?) ?? 'OFFLINE';
    const quickStatuses = ['ONLINE', 'OFFLINE', 'MAINTENANCE', 'FULL'];

    return ReLoopCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const ReLoopCardTitle(title: 'Kontrol Mesin'),
          const SizedBox(height: 12),
          const Text(
            'Ubah Status',
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: quickStatuses
                .map(
                  (s) => ReLoopButton(
                    label: s,
                    size: ReLoopButtonSize.sm,
                    expanded: false,
                    variant: currentStatus == s
                        ? ReLoopButtonVariant.primary
                        : ReLoopButtonVariant.outline,
                    onPressed: _busy ? null : () => _changeStatus(s),
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: 14),
          if (isSuperadmin) ...[
            const Divider(height: 24),
            const Text(
              'Operasi Superadmin',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: ReLoopButton(
                    label: 'Rotasi Secret',
                    icon: Icons.vpn_key,
                    size: ReLoopButtonSize.sm,
                    expanded: false,
                    onPressed: _busy ? null : _rotateSecret,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ReLoopButton(
                    label: 'Hapus Mesin',
                    icon: Icons.delete_outline,
                    variant: ReLoopButtonVariant.ghost,
                    size: ReLoopButtonSize.sm,
                    expanded: false,
                    onPressed: _busy ? null : _deleteMachine,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildSecurityCard() {
    return ReLoopCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const ReLoopCardTitle(title: 'Log Keamanan (24 terakhir)'),
          const SizedBox(height: 8),
          ..._securityEvents.take(10).map((e) {
            final data = e as Map<String, dynamic>;
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                children: [
                  const Icon(Icons.shield_outlined, size: 16, color: ReLoopColors.warning),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      (data['eventType'] ?? data['action'] ?? 'Event').toString(),
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
                  Text(
                    _formatDate((data['occurredAt'] ?? data['createdAt'])?.toString() ?? ''),
                    style: const TextStyle(fontSize: 10, color: ReLoopColors.muted),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildRemoteCommandsCard() {
    return ReLoopCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const ReLoopCardTitle(title: 'Remote Commands (20 terakhir)'),
          const SizedBox(height: 8),
          ..._remoteCommands.take(10).map((c) {
            final data = c as Map<String, dynamic>;
            final status = (data['status'] as String?) ?? '-';
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                children: [
                  const Icon(Icons.terminal_outlined, size: 16, color: ReLoopColors.info),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      (data['command'] ?? '-').toString(),
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
                  StatusBadge(statusKey: status),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _hwStatusItem(String name, bool active, IconData icon) {
    return Column(
      children: [
        Icon(
          icon,
          color: active ? (context.isDarkMode ? ReLoopColors.brand400 : ReLoopColors.brand500) : context.reloopMutedSoft,
          size: 28,
        ),
        const SizedBox(height: 4),
        Text(
          name,
          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500),
        ),
        const SizedBox(height: 2),
        Text(
          active ? 'Aktif' : 'Non-aktif',
          style: TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.bold,
            color: active ? (context.isDarkMode ? ReLoopColors.brand400 : ReLoopColors.brand600) : context.reloopMutedSoft,
          ),
        ),
      ],
    );
  }

  Widget _buildInfoCard() {
    final m = _machine!;
    final region = m['region'] as Map<String, dynamic>?;
    final org = m['organization'] as Map<String, dynamic>?;

    return ReLoopCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const ReLoopCardTitle(title: 'Spesifikasi & Aturan'),
          const SizedBox(height: 12),
          if (org != null) _infoRow('Organisasi', org['name'] as String? ?? '-'),
          if (region != null) _infoRow('Wilayah', region['name'] as String? ?? '-'),
          _infoRow('Kapasitas', '${m['capacityKg'] ?? '-'} kg'),
          _infoRow('Timeout Chamber', '${m['chamberTimeoutSeconds'] ?? '-'} detik'),
          _infoRow('Idle Timeout', '${m['sessionIdleTimeoutMinutes'] ?? '-'} menit'),
          _infoRow('Rotasi QR', '${m['qrRotationSeconds'] ?? '-'} detik'),
          if (m['latitude'] != null && m['longitude'] != null)
            _infoRow('Koordinat', '${m['latitude'].toStringAsFixed(5)}, ${m['longitude'].toStringAsFixed(5)}'),
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 130,
            child: Text(
              label,
              style: TextStyle(color: context.reloopMutedSoft, fontSize: 13),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: context.reloopForeground,
                fontSize: 13,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWasteTypesCard() {
    final m = _machine!;
    final list = m['wasteTypes'] as List?;
    if (list == null || list.isEmpty) {
      return const SizedBox.shrink();
    }

    return ReLoopCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const ReLoopCardTitle(title: 'Jenis Sampah Diterima'),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: list.map((item) {
              final wt = item['wasteType'] as Map<String, dynamic>?;
              final name = wt?['name'] as String? ?? 'Material';
              return Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: context.reloopBrandSoft,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: context.reloopBorder),
                ),
                child: Text(
                  name,
                  style: TextStyle(
                    color: context.reloopBrandText,
                    fontWeight: FontWeight.w600,
                    fontSize: 12,
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildSessionsCard() {
    if (_sessions.isEmpty) {
      return ReLoopCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const ReLoopCardTitle(title: 'Sesi Deposit Terakhir'),
            const SizedBox(height: 16),
            Center(
              child: Text(
                'Belum ada sesi di mesin ini',
                style: TextStyle(color: context.reloopMutedSoft, fontSize: 13),
              ),
            ),
          ],
        ),
      );
    }

    return ReLoopCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const ReLoopCardTitle(title: 'Sesi Deposit Terakhir'),
          const SizedBox(height: 12),
          ..._sessions.map((s) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: context.reloopBrandSoft,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Icon(Icons.history_rounded,
                          color: context.isDarkMode ? ReLoopColors.brand400 : ReLoopColors.brand500, size: 18),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _formatDate(s['startedAt'] as String? ?? ''),
                        style: TextStyle(
                          color: context.reloopForeground,
                          fontWeight: FontWeight.w500,
                          fontSize: 13,
                        ),
                      ),
                    ),
                    StatusBadge(statusKey: s['status'] as String? ?? 'ACTIVE'),
                  ],
                ),
              )),
        ],
      ),
    );
  }
}
