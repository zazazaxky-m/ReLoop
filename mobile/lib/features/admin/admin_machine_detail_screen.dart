import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../shared/widgets/reloop_card.dart';
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
  bool _isLoading = true;
  String? _error;

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
      final response = await api.get('/api/machines/${widget.machineId}');
      final data = response.data as Map<String, dynamic>;

      setState(() {
        _machine = data['machine'] as Map<String, dynamic>;
        _sessions = (_machine?['sessions'] as List? ?? []);
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = ApiClient.getErrorMessage(e);
        _isLoading = false;
      });
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
                        Text(_error!, style: const TextStyle(color: ReLoopColors.muted)),
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
                      _buildHardwareConfigCard(),
                      const SizedBox(height: 16),
                      _buildInfoCard(),
                      const SizedBox(height: 16),
                      _buildWasteTypesCard(),
                      const SizedBox(height: 16),
                      _buildSessionsCard(),
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
                style: const TextStyle(
                  color: ReLoopColors.muted,
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

  Widget _hwStatusItem(String name, bool active, IconData icon) {
    return Column(
      children: [
        Icon(
          icon,
          color: active ? ReLoopColors.brand500 : ReLoopColors.mutedSoft,
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
            color: active ? ReLoopColors.brand600 : ReLoopColors.mutedSoft,
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
              style: const TextStyle(color: ReLoopColors.mutedSoft, fontSize: 13),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                color: ReLoopColors.foreground,
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
                  color: ReLoopColors.brand50,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: ReLoopColors.brand200),
                ),
                child: Text(
                  name,
                  style: const TextStyle(
                    color: ReLoopColors.brand700,
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
                style: const TextStyle(color: ReLoopColors.mutedSoft, fontSize: 13),
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
                        color: ReLoopColors.brand50,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Icon(Icons.history_rounded,
                          color: ReLoopColors.brand500, size: 18),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _formatDate(s['startedAt'] as String? ?? ''),
                        style: const TextStyle(
                          color: ReLoopColors.foreground,
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
