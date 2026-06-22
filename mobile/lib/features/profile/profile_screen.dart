import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/auth_provider.dart';
import '../../core/models.dart';
import '../../providers/theme_provider.dart';
import '../../services/biometric_service.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../theme/colors.dart';
import 'package:go_router/go_router.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  bool _isEditing = false;
  final _nameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _isSaving = false;
  bool _biometricAvailable = false;
  bool _biometricEnabled = false;
  String? _biometricType;

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthProvider>();
    _nameCtrl.text = auth.user?.name ?? '';
    _phoneCtrl.text = auth.user?.phone ?? '';
    _checkBiometric();
  }

  Future<void> _checkBiometric() async {
    final bio = BiometricService();
    final available = await bio.isBiometricAvailable;
    final enabled = await bio.isEnabled;
    final typeName = await bio.getBiometricTypeName();
    if (mounted) {
      setState(() {
        _biometricAvailable = available;
        _biometricEnabled = enabled;
        _biometricType = typeName;
      });
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _saveProfile() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSaving = true);

    try {
      final api = context.read<ApiClient>();
      await api.patch('/api/auth/me', data: {
        'name': _nameCtrl.text.trim(),
        'phone': _phoneCtrl.text.trim(),
      });
      if (!mounted) return;
      await context.read<AuthProvider>().checkSession();
      if (!mounted) return;
      setState(() => _isEditing = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Profil berhasil diperbarui'),
          backgroundColor: ReLoopColors.success,
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Gagal memperbarui profil'),
            backgroundColor: ReLoopColors.danger,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSaving = false);
      }
    }
  }

  Future<void> _logout() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Keluar'),
        content: const Text('Apakah Anda yakin ingin keluar?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Batal'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text(
              'Keluar',
              style: TextStyle(color: ReLoopColors.danger),
            ),
          ),
        ],
      ),
    );

    if (confirm == true && mounted) {
      await context.read<AuthProvider>().logout();
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;

    if (user == null) {
      return const Center(child: CircularProgressIndicator());
    }

    return Scaffold(
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Center(
            child: Column(
              children: [
                Container(
                  width: 80,
                  height: 80,
                  decoration: BoxDecoration(
                    color: ReLoopColors.brand100,
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: Text(
                      user.name[0].toUpperCase(),
                      style: const TextStyle(
                        color: ReLoopColors.brand700,
                        fontWeight: FontWeight.w700,
                        fontSize: 32,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                if (!_isEditing) ...[
                  Text(
                    user.name,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: ReLoopColors.foreground,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    user.email,
                    style: const TextStyle(
                      color: ReLoopColors.muted,
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: 8),
                  StatusBadge(statusKey: user.status),
                ],
                if (!_isEditing) ...[
                  const SizedBox(height: 12),
                  TextButton.icon(
                    onPressed: () => setState(() => _isEditing = true),
                    icon: const Icon(Icons.edit_outlined, size: 16),
                    label: const Text('Edit Profil'),
                    style: TextButton.styleFrom(foregroundColor: ReLoopColors.brand600),
                  ),
                ] else ...[
                  const SizedBox(height: 12),
                  TextButton.icon(
                    onPressed: () {
                      setState(() {
                        _isEditing = false;
                        _nameCtrl.text = user.name;
                        _phoneCtrl.text = user.phone ?? '';
                      });
                    },
                    icon: const Icon(Icons.close, size: 16),
                    label: const Text('Batal'),
                    style: TextButton.styleFrom(foregroundColor: ReLoopColors.muted),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 32),
          if (_isEditing) ...[
            Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Nama Lengkap',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: ReLoopColors.muted,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    controller: _nameCtrl,
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.person_outline),
                    ),
                    validator: (v) {
                      if (v == null || v.trim().length < 2) {
                        return 'Nama minimal 2 karakter';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'Email',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: ReLoopColors.muted,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    initialValue: user.email,
                    enabled: false,
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.email_outlined),
                    ),
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'No. Telepon',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: ReLoopColors.muted,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    controller: _phoneCtrl,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.phone_outlined),
                    ),
                    validator: (v) {
                      if (v != null && v.trim().isNotEmpty) {
                        final digits = v.replaceAll(RegExp(r'\D'), '');
                        if (digits.length < 9 || digits.length > 16) {
                          return 'No. telepon 9-16 digit';
                        }
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 32),
                  ReLoopButton(
                    label: 'Simpan Perubahan',
                    onPressed: _isSaving ? null : _saveProfile,
                    isLoading: _isSaving,
                  ),
                ],
              ),
            ),
          ] else ...[
            ReLoopCard(
              child: Column(
                children: [
                  _InfoRow(
                    icon: Icons.person_outline,
                    label: 'Nama',
                    value: user.name,
                  ),
                  const Divider(height: 24),
                  _InfoRow(
                    icon: Icons.email_outlined,
                    label: 'Email',
                    value: user.email,
                  ),
                  const Divider(height: 24),
                  _InfoRow(
                    icon: Icons.phone_outlined,
                    label: 'No. Telepon',
                    value: user.phone ?? '-',
                  ),
                  const Divider(height: 24),
                  _InfoRow(
                    icon: Icons.badge_outlined,
                    label: 'Role',
                    value: user.role.label,
                  ),
                  if (user.organizationName != null) ...[
                    const Divider(height: 24),
                    _InfoRow(
                      icon: Icons.business_outlined,
                      label: 'Organisasi',
                      value: user.organizationName!,
                    ),
                  ],
                ],
              ),
            ),
          ],
          const SizedBox(height: 16),
          ReLoopCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const ReLoopCardTitle(title: 'Pengaturan'),
                const SizedBox(height: 16),
                _SettingsRow(
                  icon: Icons.brightness_6,
                  label: 'Tema',
                  trailing: SegmentedButton<ThemeMode>(
                    segments: const [
                      ButtonSegment(value: ThemeMode.light, label: Text('Terang'), icon: Icon(Icons.wb_sunny_outlined, size: 18)),
                      ButtonSegment(value: ThemeMode.system, label: Text('Sistem'), icon: Icon(Icons.phone_android, size: 18)),
                      ButtonSegment(value: ThemeMode.dark, label: Text('Gelap'), icon: Icon(Icons.nightlight_outlined, size: 18)),
                    ],
                    selected: {context.watch<ThemeProvider>().themeMode},
                    onSelectionChanged: (v) {
                      context.read<ThemeProvider>().setThemeMode(v.first);
                    },
                    style: const ButtonStyle(
                      visualDensity: VisualDensity.compact,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                if (_biometricAvailable) ...[
                  const Divider(height: 24),
                  _SettingsRow(
                    icon: _biometricType == 'Face ID'
                        ? Icons.face
                        : Icons.fingerprint,
                    label: 'Login dengan $_biometricType',
                    trailing: Switch.adaptive(
                      value: _biometricEnabled,
                      onChanged: (v) async {
                        await BiometricService().setEnabled(v);
                        setState(() => _biometricEnabled = v);
                        if (!v) {
                          await BiometricService().clearCredentials();
                        }
                      },
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 32),
          ReLoopButton(
            label: 'Keluar',
            icon: Icons.logout,
            variant: ReLoopButtonVariant.danger,
            onPressed: _logout,
          ),
          const SizedBox(height: 32),
          const Divider(),
          const SizedBox(height: 16),
          _LegalLink(label: 'Syarat & Ketentuan', onTap: () => context.push('/terms')),
          _LegalLink(label: 'Kebijakan Privasi', onTap: () => context.push('/privacy')),
          _LegalLink(label: 'Tentang Aplikasi', onTap: () => context.push('/about')),
          const SizedBox(height: 80),
        ],
      ),
    );
  }
}

class _SettingsRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final Widget trailing;

  const _SettingsRow({
    required this.icon,
    required this.label,
    required this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, color: ReLoopColors.mutedSoft, size: 20),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            label,
            style: const TextStyle(
              color: ReLoopColors.foreground,
              fontSize: 14,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
        trailing,
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, color: ReLoopColors.mutedSoft, size: 20),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(
                  color: ReLoopColors.mutedSoft,
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                style: const TextStyle(
                  color: ReLoopColors.foreground,
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _LegalLink extends StatelessWidget {
  final String label;
  final VoidCallback onTap;

  const _LegalLink({required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          children: [
            const Icon(Icons.chevron_right, size: 18, color: ReLoopColors.mutedSoft),
            const SizedBox(width: 8),
            Text(label, style: const TextStyle(color: ReLoopColors.muted, fontSize: 14)),
          ],
        ),
      ),
    );
  }
}
