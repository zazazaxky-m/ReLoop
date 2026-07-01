import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';

class TourismPickupsScreen extends StatefulWidget {
  const TourismPickupsScreen({super.key});

  @override
  State<TourismPickupsScreen> createState() => _TourismPickupsScreenState();
}

class _TourismPickupsScreenState extends State<TourismPickupsScreen> {
  List<dynamic> _trips = [];
  bool _isLoading = true;
  String? _error;
  final Set<String> _busyIds = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final api = context.read<ApiClient>();
      final res = await api.get('/api/mobile/tourism-pickups');
      final data = res.data as Map<String, dynamic>;
      setState(() {
        _trips = (data['trips'] as List?)?.cast<dynamic>() ?? [];
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = ApiClient.getErrorMessage(e);
        _isLoading = false;
      });
    }
  }

  Future<void> _recordPickup(Map<String, dynamic> trip) async {
    final id = trip['id'] as String;
    setState(() => _busyIds.add(id));
    try {
      final api = context.read<ApiClient>();
      final bagCount = (trip['bagCount'] as num?)?.toInt() ?? 0;
      await api.post('/api/manual-validations', data: {
        'tripId': id,
        'validationStage': 'BANK_SAMPAH_PICKUP',
        'gateType': 'BANK_SAMPAH',
        'returnedBagCount': bagCount,
        'appCompleted': true,
        'notes': 'Pickup sampah terpilah oleh Bank Sampah',
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Pickup wisata berhasil dicatat'),
          backgroundColor: ReLoopColors.success,
        ),
      );
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(ApiClient.getErrorMessage(e)),
          backgroundColor: ReLoopColors.danger,
        ),
      );
    } finally {
      if (mounted) setState(() => _busyIds.remove(id));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Pickup Wisata')),
      body: RefreshIndicator(onRefresh: _load, child: _buildBody()),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          SkeletonListTile(),
          SizedBox(height: 8),
          SkeletonListTile(),
        ],
      );
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, size: 48, color: ReLoopColors.mutedSoft),
            const SizedBox(height: 12),
            Text(_error!, style: TextStyle(color: context.reloopMuted)),
            const SizedBox(height: 12),
            TextButton(onPressed: _load, child: const Text('Coba Lagi')),
          ],
        ),
      );
    }
    if (_trips.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            'Belum ada pickup wisata. Trip wisata yang sudah check-out akan muncul di sini.',
            textAlign: TextAlign.center,
            style: TextStyle(color: context.reloopMuted),
          ),
        ),
      );
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 80),
      children: _trips.map((t) => _buildCard(t as Map<String, dynamic>)).toList(),
    );
  }

  Widget _buildCard(Map<String, dynamic> trip) {
    final id = trip['id'] as String? ?? '';
    final groupName = (trip['groupName'] as String?) ?? '-';
    final campaignName = (trip['campaignName'] as String?) ?? '-';
    final orgName = (trip['organizationName'] as String?) ?? '-';
    final travelAgent = (trip['travelAgentName'] as String?) ?? 'Tanpa agent';
    final bagCount = (trip['bagCount'] as num?)?.toInt() ?? 0;
    final complianceStatus = (trip['complianceStatus'] as String?) ?? 'NOT_STARTED';
    final complianceScore = (trip['complianceScore'] as num?)?.toInt() ?? 0;
    final pickedUp = trip['pickedUp'] == true;
    final isBusy = _busyIds.contains(id);

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: ReLoopCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              groupName,
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
            ),
            const SizedBox(height: 4),
            Text(
              '$orgName - $travelAgent',
              style: TextStyle(color: context.reloopMutedSoft, fontSize: 12),
            ),
            const SizedBox(height: 6),
            Text(
              campaignName,
              style: TextStyle(color: context.reloopBrandText, fontSize: 12, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                _chip('Tas: $bagCount'),
                const SizedBox(width: 6),
                _chip('Compliance: $complianceScore/100'),
                const SizedBox(width: 6),
                _chip(complianceStatus),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (pickedUp)
                  const Text(
                    'Sudah dijemput',
                    style: TextStyle(
                      color: ReLoopColors.success,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  )
                else
                  ReLoopButton(
                    label: isBusy ? 'Mencatat...' : 'Catat Pickup',
                    icon: Icons.check,
                    size: ReLoopButtonSize.sm,
                    expanded: false,
                    isLoading: isBusy,
                    onPressed: isBusy ? null : () => _recordPickup(trip),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _chip(String text) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: ReLoopColors.background,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(
          text,
          style: const TextStyle(fontSize: 10, color: ReLoopColors.muted, fontWeight: FontWeight.w500),
        ),
      );
}
