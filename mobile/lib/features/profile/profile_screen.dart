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
  final _emailCtrl = TextEditingController();
  final _currentPasswordCtrl = TextEditingController();
  final _newPasswordCtrl = TextEditingController();
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
    _emailCtrl.text = auth.user?.email ?? '';
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
    _emailCtrl.dispose();
    _currentPasswordCtrl.dispose();
    _newPasswordCtrl.dispose();
    super.dispose();
  }

  Future<void> _saveProfile() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSaving = true);

    try {
      final api = context.read<ApiClient>();
      await api.patch(
        '/api/auth/me',
        data: {
          'name': _nameCtrl.text.trim(),
          'phone': _phoneCtrl.text.trim(),
          'email': _emailCtrl.text.trim(),
          if (_currentPasswordCtrl.text.isNotEmpty)
            'currentPassword': _currentPasswordCtrl.text,
          if (_newPasswordCtrl.text.isNotEmpty)
            'newPassword': _newPasswordCtrl.text,
        },
      );
      if (!mounted) return;
      await context.read<AuthProvider>().checkSession();
      if (!mounted) return;
      setState(() {
        _isEditing = false;
        _currentPasswordCtrl.clear();
        _newPasswordCtrl.clear();
      });
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
        title: Text('Keluar'),
        content: Text('Apakah Anda yakin ingin keluar?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text('Batal'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(
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

  Future<void> _toggleBiometric(bool enable, String email) async {
    if (!enable) {
      await BiometricService().setEnabled(false);
      await BiometricService().clearCredentials();
      if (mounted) {
        setState(() => _biometricEnabled = false);
      }
      return;
    }

    final passwordCtrl = TextEditingController();
    bool obscure = true;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: Text('Konfirmasi Password', style: TextStyle(color: context.reloopForeground)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Masukkan password Anda untuk mengaktifkan $_biometricType.', style: TextStyle(color: context.reloopMuted)),
              const SizedBox(height: 16),
              TextFormField(
                controller: passwordCtrl,
                obscureText: obscure,
                autofocus: true,
                decoration: InputDecoration(
                  hintText: 'Password Anda',
                  suffixIcon: IconButton(
                    icon: Icon(obscure ? Icons.visibility_off : Icons.visibility),
                    onPressed: () => setDialogState(() => obscure = !obscure),
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Batal'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Lanjut'),
            ),
          ],
        ),
      ),
    );

    if (confirmed != true || passwordCtrl.text.isEmpty) return;

    final auth = context.read<AuthProvider>();
    final valid = await auth.verifyPassword(passwordCtrl.text);
    if (!valid) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(auth.error ?? 'Password tidak sesuai')),
        );
      }
      return;
    }

    final authenticated = await BiometricService().authenticate(
      reason: 'Verifikasi identitas untuk mengaktifkan $_biometricType',
    );

    if (authenticated) {
      await BiometricService().saveCredentials(email, passwordCtrl.text);
      await BiometricService().setEnabled(true);
      if (mounted) {
        setState(() => _biometricEnabled = true);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$_biometricType berhasil diaktifkan')),
        );
      }
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Gagal memverifikasi identitas')),
        );
      }
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
                    color: context.reloopBrandSoftStrong,
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: Text(
                      user.name[0].toUpperCase(),
                      style: TextStyle(
                        color: context.reloopBrandText,
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
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: context.reloopForeground,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    user.email,
                    style: TextStyle(
                      color: context.reloopMuted,
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
                    icon: Icon(Icons.edit_outlined, size: 16),
                    label: Text('Edit Profil'),
                    style: TextButton.styleFrom(
                      foregroundColor: ReLoopColors.brand600,
                    ),
                  ),
                ] else ...[
                  const SizedBox(height: 12),
                  TextButton.icon(
                    onPressed: () {
                      setState(() {
                        _isEditing = false;
                        _nameCtrl.text = user.name;
                        _phoneCtrl.text = user.phone ?? '';
                        _emailCtrl.text = user.email;
                        _currentPasswordCtrl.clear();
                        _newPasswordCtrl.clear();
                      });
                    },
                    icon: Icon(Icons.close, size: 16),
                    label: Text('Batal'),
                    style: TextButton.styleFrom(
                      foregroundColor: context.reloopMuted,
                    ),
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
                  Text(
                    'Nama Lengkap',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: context.reloopMuted,
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
                  Text(
                    'Email',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: context.reloopMuted,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    controller: _emailCtrl,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.email_outlined),
                      helperText:
                          'Perubahan email memerlukan password saat ini.',
                    ),
                    validator: (value) => value != null && value.contains('@')
                        ? null
                        : 'Email tidak valid',
                  ),
                  const SizedBox(height: 20),
                  Text(
                    'No. Telepon',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: context.reloopMuted,
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
                  const SizedBox(height: 20),
                  Text(
                    'Password Saat Ini',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: context.reloopMuted,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    controller: _currentPasswordCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.lock_outline_rounded),
                      hintText: 'Wajib untuk ganti email atau password',
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text(
                    'Password Baru',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: context.reloopMuted,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    controller: _newPasswordCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.password_rounded),
                      hintText: 'Kosongkan jika tidak ingin mengganti',
                    ),
                    validator: (value) {
                      if (value != null &&
                          value.isNotEmpty &&
                          value.length < 6) {
                        return 'Password minimal 6 karakter';
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
                  label: 'Tema Gelap',
                  trailing: Switch.adaptive(
                    value: context.watch<ThemeProvider>().isDark,
                    onChanged: (v) {
                      context.read<ThemeProvider>().toggle();
                    },
                  ),
                ),
                if (_biometricAvailable) ...[
                  const Divider(height: 24),
                  _SettingsRow(
                    icon: _biometricType == 'Face ID'
                        ? Icons.face
                        : Icons.fingerprint,
                    label: 'Login dengan $_biometricType',
                    trailing: Switch.adaptive(
                      value: _biometricEnabled,
                      onChanged: (v) => _toggleBiometric(v, user.email),
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
          _LegalLink(
            label: 'Syarat & Ketentuan',
            onTap: () => context.push('/terms'),
          ),
          _LegalLink(
            label: 'Kebijakan Privasi',
            onTap: () => context.push('/privacy'),
          ),
          _LegalLink(
            label: 'Tentang Aplikasi',
            onTap: () => context.push('/about'),
          ),
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
        Icon(icon, color: context.reloopMutedSoft, size: 20),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              color: context.reloopForeground,
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
        Icon(icon, color: context.reloopMutedSoft, size: 20),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  color: context.reloopMutedSoft,
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                style: TextStyle(
                  color: context.reloopForeground,
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
            Icon(
              Icons.chevron_right,
              size: 18,
              color: context.reloopMutedSoft,
            ),
            const SizedBox(width: 8),
            Text(
              label,
              style: TextStyle(color: context.reloopMuted, fontSize: 14),
            ),
          ],
        ),
      ),
    );
  }
}
