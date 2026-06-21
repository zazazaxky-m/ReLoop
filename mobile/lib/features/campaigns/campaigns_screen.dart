import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/reloop_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';

class CampaignsScreen extends StatefulWidget {
  const CampaignsScreen({super.key});

  @override
  State<CampaignsScreen> createState() => _CampaignsScreenState();
}

class _CampaignsScreenState extends State<CampaignsScreen> {
  List<CampaignInfo> _campaigns = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadCampaigns();
  }

  Future<void> _loadCampaigns() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final api = context.read<ApiClient>();
      final response = await api.get('/api/campaigns');
      final data = response.data as Map<String, dynamic>;
      setState(() {
        _campaigns = (data['campaigns'] as List? ?? [])
            .map((e) => CampaignInfo.fromJson(e as Map<String, dynamic>))
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Program')),
      body: RefreshIndicator(
        onRefresh: _loadCampaigns,
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
            TextButton(onPressed: _loadCampaigns, child: const Text('Coba Lagi')),
          ],
        ),
      );
    }

    if (_campaigns.isEmpty) {
      return ListView(
        children: [
          const SizedBox(height: 80),
          const Center(
            child: Column(
              children: [
                Icon(Icons.campaign_outlined,
                    size: 48, color: ReLoopColors.mutedSoft),
                SizedBox(height: 12),
                Text(
                  'Belum ada program tersedia',
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
      children: _campaigns.map((c) {
        IconData typeIcon;
        switch (c.campaignType) {
          case 'TRASH_BAG':
            typeIcon = Icons.delete;
          case 'EVENT':
            typeIcon = Icons.event;
          case 'SCHOOL_PROGRAM':
            typeIcon = Icons.school;
          case 'TOURISM_PROGRAM':
            typeIcon = Icons.tour;
          default:
            typeIcon = Icons.recycling;
        }

        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: ReLoopCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                  Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: ReLoopColors.brand50,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Icon(typeIcon,
                            color: ReLoopColors.brand500, size: 22),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              c.name,
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                                color: ReLoopColors.foreground,
                                fontSize: 14,
                              ),
                            ),
                            if (c.organizationName != null)
                              Text(
                                c.organizationName!,
                                style: const TextStyle(
                                  color: ReLoopColors.mutedSoft,
                                  fontSize: 12,
                                ),
                              ),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.share_outlined,
                            size: 20, color: ReLoopColors.mutedSoft),
                        onPressed: () {
                          Share.share(
                            'Yuk ikutan program ${c.name} di ReLoop! '
                            '${c.description ?? ''} '
                            'Download ReLoop sekarang.',
                          );
                        },
                      ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        StatusBadge(statusKey: c.status),
                        const SizedBox(height: 4),
                        if (c.visibility == 'PRIVATE')
                          const ReLoopBadge(
                            label: 'Private',
                            tone: BadgeTone.warning,
                            icon: Icons.lock_outline,
                          ),
                      ],
                    ),
                  ],
                ),
                if (c.description != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    c.description!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: ReLoopColors.muted,
                      fontSize: 13,
                    ),
                  ),
                ],
              ],
            ),
          ),
        );
      }).toList(),
    );
  }
}
