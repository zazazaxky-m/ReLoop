import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'machine_report_form.dart';

class MachineDetailScreen extends StatefulWidget {
  final String machineCode;

  const MachineDetailScreen({super.key, required this.machineCode});

  @override
  State<MachineDetailScreen> createState() => _MachineDetailScreenState();
}

class _MachineDetailScreenState extends State<MachineDetailScreen> {
  MachineInfo? _machine;
  List<DepositSession> _sessions = [];
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
      final response = await api.get('/api/machines/${widget.machineCode}');
      final data = response.data as Map<String, dynamic>;

      setState(() {
        _machine = MachineInfo.fromJson(data['machine'] as Map<String, dynamic>);
        _sessions = (data['recentSessions'] as List? ?? [])
            .map((e) => DepositSession.fromJson(e as Map<String, dynamic>))
            .toList();
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
    return Scaffold(
      appBar: AppBar(title: Text(_machine?.name ?? 'Mesin')),
      body: _isLoading
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
                    _buildInfoCard(),
                    const SizedBox(height: 16),
                    _buildWasteTypesCard(),
                    const SizedBox(height: 16),
                    _buildSessionsCard(),
                    const SizedBox(height: 16),
                    _buildReportButton(),
                    const SizedBox(height: 80),
                  ],
                ),
    );
  }

  Widget _buildStatusCard() {
    final m = _machine!;

    Color statusColor;
    switch (m.status) {
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
            m.name,
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
              StatusBadge(statusKey: m.status),
              const SizedBox(width: 8),
              Text(
                'Kode: ${m.machineCode}',
                style: const TextStyle(
                  color: ReLoopColors.muted,
                  fontSize: 13,
                ),
              ),
            ],
          ),
          if (m.fillLevelPercent > 0) ...[
            const SizedBox(height: 16),
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: LinearProgressIndicator(
                value: m.fillLevelPercent / 100,
                minHeight: 10,
                backgroundColor: Colors.white.withValues(alpha: 0.3),
                valueColor: AlwaysStoppedAnimation<Color>(statusColor),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Kapasitas: ${m.fillLevelPercent}%',
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildInfoCard() {
    final m = _machine!;

    return ReLoopCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const ReLoopCardTitle(title: 'Informasi Mesin'),
          const SizedBox(height: 12),
          _infoRow('Nama', m.name),
          _infoRow('Kode', m.machineCode),
          if (m.organizationName != null)
            _infoRow('Organisasi', m.organizationName!),
          _infoRow('Status', m.status),
          _infoRow('Kapasitas', '${m.fillLevelPercent}%'),
          if (m.latitude != null && m.longitude != null)
            _infoRow('Lokasi', '${m.latitude!.toStringAsFixed(6)}, ${m.longitude!.toStringAsFixed(6)}'),
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
            width: 100,
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
    if (m.supportedWasteTypes == null || m.supportedWasteTypes!.isEmpty) {
      return const SizedBox.shrink();
    }

    return ReLoopCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const ReLoopCardTitle(title: 'Jenis Sampah Didukung'),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: m.supportedWasteTypes!
                .map((wt) => Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      decoration: BoxDecoration(
                        color: ReLoopColors.brand50,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: ReLoopColors.brand200),
                      ),
                      child: Text(
                        wt.name,
                        style: const TextStyle(
                          color: ReLoopColors.brand700,
                          fontWeight: FontWeight.w600,
                          fontSize: 13,
                        ),
                      ),
                    ))
                .toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildSessionsCard() {
    if (_sessions.isEmpty) return const SizedBox.shrink();

    return ReLoopCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              ReLoopCardTitle(title: 'Sesi Terakhir'),
            ],
          ),
          const SizedBox(height: 12),
          ..._sessions.take(5).map((s) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: ReLoopColors.mintSoft,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Icon(Icons.recycling,
                          color: ReLoopColors.brand500, size: 18),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _formatDate(s.startedAt),
                        style: const TextStyle(
                          color: ReLoopColors.foreground,
                          fontWeight: FontWeight.w500,
                          fontSize: 13,
                        ),
                      ),
                    ),
                    StatusBadge(statusKey: s.status),
                  ],
                ),
              )),
        ],
      ),
    );
  }

  Widget _buildReportButton() {
    return ReLoopButton(
      label: 'Laporkan Masalah',
      icon: Icons.report_problem_outlined,
      variant: ReLoopButtonVariant.outline,
      onPressed: () {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => MachineReportForm(machineCode: widget.machineCode),
          ),
        );
      },
    );
  }
}
