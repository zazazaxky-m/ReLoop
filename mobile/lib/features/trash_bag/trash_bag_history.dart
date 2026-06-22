import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/models/trash_bag.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';

class TrashBagHistory extends StatefulWidget {
  const TrashBagHistory({super.key});

  @override
  State<TrashBagHistory> createState() => _TrashBagHistoryState();
}

class _TrashBagHistoryState extends State<TrashBagHistory> {
  List<TrashBag> _bags = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  Future<void> _loadHistory() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final api = context.read<ApiClient>();
      final response = await api.get('/api/trash-bags');
      final data = response.data as Map<String, dynamic>;
      setState(() {
        _bags = (data['trashBags'] as List? ?? [])
            .map((e) => TrashBag.fromJson(e as Map<String, dynamic>))
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
      appBar: AppBar(title: const Text('Riwayat Trash Bag')),
      body: RefreshIndicator(
        onRefresh: _loadHistory,
        child: _buildBody(),
      ),
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
            Text(_error!, style: const TextStyle(color: ReLoopColors.muted)),
            const SizedBox(height: 12),
            TextButton(onPressed: _loadHistory, child: const Text('Coba Lagi')),
          ],
        ),
      );
    }

    if (_bags.isEmpty) {
      return ListView(
        children: [
          const SizedBox(height: 80),
          const Center(
            child: Column(
              children: [
                Icon(Icons.delete_outline, size: 48, color: ReLoopColors.mutedSoft),
                SizedBox(height: 12),
                Text(
                  'Belum ada trash bag',
                  style: TextStyle(color: ReLoopColors.mutedSoft, fontSize: 14),
                ),
              ],
            ),
          ),
        ],
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: _bags.map((bag) {
        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: ReLoopCard(
            padding: const EdgeInsets.all(12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    color: ReLoopColors.background,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: bag.photoUrl != null
                      ? ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: CachedNetworkImage(
                            imageUrl: bag.photoUrl!,
                            fit: BoxFit.cover,
                            placeholder: (_, __) => Container(
                              color: ReLoopColors.border,
                              child: const Icon(Icons.image, color: ReLoopColors.mutedSoft),
                            ),
                            errorWidget: (_, _, _) => const Icon(
                              Icons.delete_outline,
                              color: ReLoopColors.mutedSoft,
                            ),
                          ),
                        )
                      : const Icon(Icons.delete_outline,
                          color: ReLoopColors.mutedSoft),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            bag.wasteTypeName ?? 'Sampah',
                            style: const TextStyle(
                              fontWeight: FontWeight.w600,
                              color: ReLoopColors.foreground,
                              fontSize: 14,
                            ),
                          ),
                          StatusBadge(statusKey: bag.status),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Text(
                            '${bag.quantity} karung',
                            style: const TextStyle(
                              color: ReLoopColors.muted,
                              fontSize: 12,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            _formatDate(bag.createdAt),
                            style: const TextStyle(
                              color: ReLoopColors.mutedSoft,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                      if (bag.adminNote != null) ...[
                        const SizedBox(height: 8),
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: ReLoopColors.background,
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            bag.adminNote!,
                            style: const TextStyle(
                              color: ReLoopColors.muted,
                              fontSize: 12,
                              fontStyle: FontStyle.italic,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }
}
