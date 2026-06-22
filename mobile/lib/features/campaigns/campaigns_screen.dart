import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/auth_provider.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';

class CampaignsScreen extends StatefulWidget {
  const CampaignsScreen({super.key});

  @override
  State<CampaignsScreen> createState() => _CampaignsScreenState();
}

class _CampaignsScreenState extends State<CampaignsScreen> {
  List<CampaignInfo> _eligible = [];
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
      final auth = context.read<AuthProvider>();
      final userEmail = auth.user?.email ?? '';

      final response = await api.get('/api/public/campaigns');
      final data = response.data as Map<String, dynamic>;
      final all = (data['campaigns'] as List? ?? [])
          .map((e) => CampaignInfo.fromJson(e as Map<String, dynamic>))
          .toList();

      final now = DateTime.now();

      setState(() {
        _eligible = all.where((c) {
          if (c.status != 'ACTIVE') return false;
          if (c.startAt != null && c.startAt!.isAfter(now)) return false;
          if (c.endAt != null && c.endAt!.isBefore(now)) return false;
          if (c.visibility == 'PRIVATE') {
            if (c.allowedEmailDomains == null || c.allowedEmailDomains!.isEmpty) return false;
            final userDomain = '@${userEmail.split('@').last}';
            return c.allowedEmailDomains!.any((d) => d.toLowerCase() == userDomain.toLowerCase());
          }
          return true;
        }).toList();
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
      appBar: AppBar(
        title: const Text('Program Aktif'),
      ),
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
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off, size: 48, color: ReLoopColors.mutedSoft),
              const SizedBox(height: 12),
              Text(_error!, textAlign: TextAlign.center,
                  style: const TextStyle(color: ReLoopColors.muted)),
              const SizedBox(height: 12),
              TextButton(onPressed: _loadCampaigns, child: const Text('Coba Lagi')),
            ],
          ),
        ),
      );
    }

    if (_eligible.isEmpty) {
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
                  'Tidak ada program yang memenuhi syarat Anda.',
                  style: TextStyle(color: ReLoopColors.mutedSoft, fontSize: 14),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ],
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: _eligible.map((c) => _buildCampaignCard(c)).toList(),
    );
  }

  Widget _buildCampaignCard(CampaignInfo c) {
    IconData typeIcon;
    switch (c.campaignType) {
      case 'TRASH_BAG':
        typeIcon = Icons.delete;
        break;
      case 'EVENT':
        typeIcon = Icons.event;
        break;
      case 'SCHOOL_PROGRAM':
        typeIcon = Icons.school;
        break;
      case 'TOURISM_PROGRAM':
        typeIcon = Icons.tour;
        break;
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
                  child: Icon(typeIcon, color: ReLoopColors.brand500, size: 22),
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
                StatusBadge(statusKey: c.status),
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
            if (c.rewardMultiplier != null) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: ReLoopColors.brand50,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  'Reward ${c.rewardMultiplier!.toStringAsFixed(1)}x',
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: ReLoopColors.brand700,
                  ),
                ),
              ),
            ],
            if (c.startAt != null || c.endAt != null) ...[
              const SizedBox(height: 6),
              Text(
                '${c.startAt != null ? '${c.startAt!.day}/${c.startAt!.month}/${c.startAt!.year}' : ''}'
                '${c.startAt != null && c.endAt != null ? ' - ' : ''}'
                '${c.endAt != null ? '${c.endAt!.day}/${c.endAt!.month}/${c.endAt!.year}' : ''}',
                style: const TextStyle(fontSize: 11, color: ReLoopColors.mutedSoft),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
