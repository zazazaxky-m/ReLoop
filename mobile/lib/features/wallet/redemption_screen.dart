import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/models/redemption.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';

class RedemptionScreen extends StatefulWidget {
  const RedemptionScreen({super.key});

  @override
  State<RedemptionScreen> createState() => _RedemptionScreenState();
}

class _RedemptionScreenState extends State<RedemptionScreen> {
  List<Redemption> _redemptions = [];
  List<PayoutAccountModel> _accounts = [];
  int _available = 0;
  int _minRedemption = 0;
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final api = context.read<ApiClient>();
      final response = await api.get('/api/wallet');

      final data = response.data as Map<String, dynamic>;
      final balance = data['balance'] as Map<String, dynamic>?;

      setState(() {
        _available = (balance?['available'] as num?)?.toInt() ?? 0;
        _minRedemption = (data['minRedemption'] as num?)?.toInt() ?? 0;
        _accounts = (data['payoutAccounts'] as List? ?? [])
            .map((e) => PayoutAccountModel.fromJson(e as Map<String, dynamic>))
            .toList();
        _redemptions = (data['redemptions'] as List? ?? [])
            .map((e) => Redemption.fromJson(e as Map<String, dynamic>))
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

  Future<void> _requestRedemption() async {
    if (_accounts.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tambahkan akun pencairan terlebih dahulu')),
      );
      return;
    }

    if (_available < _minRedemption) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Minimal pencairan Rp ${_fmt(_minRedemption)}')),
      );
      return;
    }

    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cairkan Saldo'),
        content: Text(
          'Ajukan pencairan Rp ${_fmt(_available)} ke ${_accounts.first.provider} (${_accounts.first.accountIdentifier})?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Batal'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Ya, Cairkan'),
          ),
        ],
      ),
    );

    if (confirm != true || !mounted) return;

    try {
      final api = context.read<ApiClient>();
      await api.post('/api/wallet/redemption', data: {
        'amount': _available,
        'payoutAccountId': _accounts.first.id,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Pengajuan pencairan berhasil'),
          backgroundColor: ReLoopColors.success,
        ),
      );
      _loadData();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(ApiClient.getErrorMessage(e)),
            backgroundColor: ReLoopColors.danger,
          ),
        );
      }
    }
  }

  String _fmt(int amount) {
    return amount.toString().replaceAllMapped(
      RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
      (m) => '${m[1]}.',
    );
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
      appBar: AppBar(title: const Text('Pencairan Saldo')),
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
                      TextButton(onPressed: _loadData, child: const Text('Coba Lagi')),
                    ],
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [ReLoopColors.brand600, ReLoopColors.brand700],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Saldo Tersedia',
                            style: TextStyle(color: Colors.white70, fontSize: 13),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Rp ${_fmt(_available)}',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 36,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Minimal pencairan: Rp ${_fmt(_minRedemption)}',
                            style: const TextStyle(color: Colors.white60, fontSize: 12),
                          ),
                          const SizedBox(height: 16),
                          ReLoopButton(
                            label: _available >= _minRedemption
                                ? 'Cairkan Sekarang'
                                : 'Saldo Belum Mencukupi',
                            onPressed: _available >= _minRedemption ? _requestRedemption : null,
                            size: ReLoopButtonSize.md,
                          ),
                        ],
                      ),
                    ),
                    if (_accounts.isNotEmpty) ...[
                      const SizedBox(height: 20),
                      const Text(
                        'Rekening Tujuan',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: ReLoopColors.foreground,
                        ),
                      ),
                      const SizedBox(height: 8),
                      ReLoopCard(
                        child: Row(
                          children: [
                            Container(
                              width: 44,
                              height: 44,
                              decoration: BoxDecoration(
                                color: ReLoopColors.brand50,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: const Icon(Icons.account_balance,
                                  color: ReLoopColors.brand500),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _accounts.first.provider,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w600,
                                      color: ReLoopColors.foreground,
                                      fontSize: 14,
                                    ),
                                  ),
                                  Text(
                                    _accounts.first.accountIdentifier,
                                    style: const TextStyle(
                                      color: ReLoopColors.mutedSoft,
                                      fontSize: 13,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            StatusBadge(statusKey: _accounts.first.status),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: 20),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Riwayat Pencairan',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: ReLoopColors.foreground,
                          ),
                        ),
                        TextButton(
                          onPressed: () {},
                          child: const Text('Kelola Akun'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (_redemptions.isEmpty)
                      ReLoopCard(
                        child: Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Column(
                              children: [
                                const Icon(Icons.history,
                                    size: 40, color: ReLoopColors.mutedSoft),
                                const SizedBox(height: 8),
                                const Text(
                                  'Belum ada pencairan',
                                  style: TextStyle(color: ReLoopColors.mutedSoft),
                                ),
                              ],
                            ),
                          ),
                        ),
                      )
                    else
                      ..._redemptions.map((r) => Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: ReLoopCard(
                              child: Row(
                                children: [
                                  Container(
                                    width: 40,
                                    height: 40,
                                    decoration: BoxDecoration(
                                      color: ReLoopColors.brand50,
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: const Icon(Icons.payment,
                                        color: ReLoopColors.brand500, size: 20),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          r.amountFormatted,
                                          style: const TextStyle(
                                            fontWeight: FontWeight.w600,
                                            color: ReLoopColors.foreground,
                                            fontSize: 14,
                                          ),
                                        ),
                                        Text(
                                          '${r.provider} - ${_formatDate(r.createdAt)}',
                                          style: const TextStyle(
                                            color: ReLoopColors.mutedSoft,
                                            fontSize: 12,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  StatusBadge(statusKey: r.status),
                                ],
                              ),
                            ),
                          )),
                    const SizedBox(height: 80),
                  ],
                ),
    );
  }
}
