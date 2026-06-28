import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
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
  final _amountCtrl = TextEditingController();
  String? _selectedAccountId;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _amountCtrl.dispose();
    super.dispose();
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

      final accounts = (data['payoutAccounts'] as List? ?? [])
          .map((e) => PayoutAccountModel.fromJson(e as Map<String, dynamic>))
          .toList();

      setState(() {
        _available = (balance?['available'] as num?)?.toInt() ?? 0;
        _minRedemption = (data['minRedemption'] as num?)?.toInt() ?? 0;
        _accounts = accounts;
        _redemptions = (data['redemptions'] as List? ?? [])
            .map((e) => Redemption.fromJson(e as Map<String, dynamic>))
            .toList();
        _isLoading = false;
        if (_accounts.isNotEmpty && _selectedAccountId == null) {
          _selectedAccountId = _accounts.first.id;
        }
        if (_amountCtrl.text.isEmpty && _available > 0) {
          _amountCtrl.text = _available.toString();
        }
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

    final amountText = _amountCtrl.text.trim();
    if (amountText.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Masukkan jumlah pencairan')),
      );
      return;
    }

    final amount = int.tryParse(amountText);
    if (amount == null || amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Jumlah tidak valid')),
      );
      return;
    }

    if (amount < _minRedemption) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Minimal pencairan Rp ${_fmt(_minRedemption)}')),
      );
      return;
    }

    if (amount > _available) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Saldo tidak mencukupi. Maks Rp ${_fmt(_available)}')),
      );
      return;
    }

    if (_selectedAccountId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pilih akun tujuan')),
      );
      return;
    }

    final selectedAcc = _accounts.firstWhere((a) => a.id == _selectedAccountId);

    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cairkan Saldo'),
        content: Text(
          'Ajukan pencairan Rp ${_fmt(amount)} ke ${selectedAcc.provider} (${selectedAcc.accountIdentifier})?',
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
      await api.post('/api/redemptions', data: {
        'amount': amount,
        'payoutAccountId': _selectedAccountId,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Pengajuan pencairan berhasil'),
          backgroundColor: ReLoopColors.success,
        ),
      );
      _amountCtrl.clear();
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

  Future<void> _cancelRedemption(String redemptionId) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Batalkan Pencairan?'),
        content: const Text('Pencairan yang dibatalkan akan mengembalikan saldo ke akun Anda.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Tidak')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: ReLoopColors.danger),
            child: const Text('Ya, Batalkan'),
          ),
        ],
      ),
    );

    if (confirm != true || !mounted) return;

    try {
      final api = context.read<ApiClient>();
      await api.patch('/api/redemptions/$redemptionId', data: {'action': 'cancel'});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pencairan dibatalkan'), backgroundColor: ReLoopColors.success),
      );
      _loadData();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiClient.getErrorMessage(e)), backgroundColor: ReLoopColors.danger),
        );
      }
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
                      Text(_error!, style: TextStyle(color: context.reloopMuted)),
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
                          const SizedBox(height: 20),
                          TextField(
                            controller: _amountCtrl,
                            keyboardType: TextInputType.number,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.w600,
                            ),
                            decoration: InputDecoration(
                              hintText: 'Masukkan jumlah',
                              hintStyle: const TextStyle(color: Colors.white38),
                              filled: true,
                              fillColor: Colors.white.withValues(alpha: 0.15),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide.none,
                              ),
                              suffixText: 'Rp',
                              suffixStyle: const TextStyle(color: Colors.white70),
                            ),
                          ),
                          const SizedBox(height: 12),
                          if (_accounts.isNotEmpty)
                            DropdownButtonFormField<String>(
                              value: _selectedAccountId,
                              decoration: InputDecoration(
                                labelText: 'Rekening Tujuan',
                                labelStyle: const TextStyle(color: Colors.white70),
                                filled: true,
                                fillColor: Colors.white.withValues(alpha: 0.15),
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: BorderSide.none,
                                ),
                              ),
                              dropdownColor: ReLoopColors.brand700,
                              style: const TextStyle(color: Colors.white),
                              items: _accounts.map((a) {
                                return DropdownMenuItem(
                                  value: a.id,
                                  child: Text('${a.provider} · ${a.accountIdentifier}',
                                    style: const TextStyle(color: Colors.white),
                                  ),
                                );
                              }).toList(),
                              onChanged: (v) => setState(() => _selectedAccountId = v),
                            ),
                          const SizedBox(height: 16),
                          ReLoopButton(
                            label: _accounts.isEmpty
                                ? 'Tambah Akun Dulu'
                                : _available >= _minRedemption
                                    ? 'Cairkan Sekarang'
                                    : 'Saldo Belum Mencukupi',
                            onPressed: _accounts.isEmpty
                                ? () => context.push('/wallet/add-account')
                                : _available >= _minRedemption ? _requestRedemption : null,
                            size: ReLoopButtonSize.md,
                          ),
                        ],
                      ),
                    ),
                    if (_accounts.isNotEmpty) ...[
                      const SizedBox(height: 20),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'Rekening Tujuan',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                              color: context.reloopForeground,
                            ),
                          ),
                          TextButton(
                            onPressed: () => context.push('/wallet/add-account'),
                            child: const Text('Kelola Akun'),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      ..._accounts.map((a) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: ReLoopCard(
                          child: Row(
                            children: [
                              Container(
                                width: 44,
                                height: 44,
                                decoration: BoxDecoration(
                                  color: context.reloopBrandSoft,
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Icon(Icons.account_balance,
                                    color: context.isDarkMode ? ReLoopColors.brand400 : ReLoopColors.brand500),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      a.provider,
                                      style: TextStyle(
                                        fontWeight: FontWeight.w600,
                                        color: context.reloopForeground,
                                        fontSize: 14,
                                      ),
                                    ),
                                    Text(
                                      a.accountIdentifier,
                                      style: TextStyle(
                                        color: context.reloopMutedSoft,
                                        fontSize: 13,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              StatusBadge(statusKey: a.status),
                            ],
                          ),
                        ),
                      )),
                    ],
                    const SizedBox(height: 20),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'Riwayat Pencairan',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: context.reloopForeground,
                          ),
                        ),
                        TextButton(
                          onPressed: () => context.push('/wallet/add-account'),
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
                                Text(
                                  'Belum ada pencairan',
                                  style: TextStyle(color: context.reloopMutedSoft),
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
                                      color: context.reloopBrandSoft,
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Icon(Icons.payment,
                                        color: context.isDarkMode ? ReLoopColors.brand400 : ReLoopColors.brand500, size: 20),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          r.amountFormatted,
                                          style: TextStyle(
                                            fontWeight: FontWeight.w600,
                                            color: context.reloopForeground,
                                            fontSize: 14,
                                          ),
                                        ),
                                        Text(
                                          '${r.provider} - ${_formatDate(r.createdAt)}',
                                          style: TextStyle(
                                            color: context.reloopMutedSoft,
                                            fontSize: 12,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  StatusBadge(statusKey: r.status),
                                  if (r.status == 'REQUESTED')
                                    IconButton(
                                      icon: const Icon(Icons.cancel_outlined, size: 16, color: ReLoopColors.danger),
                                      tooltip: 'Batalkan',
                                      onPressed: () => _cancelRedemption(r.id),
                                      padding: EdgeInsets.zero,
                                      constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                                    ),
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
