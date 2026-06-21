import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/auth_provider.dart';
import '../../services/biometric_service.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../theme/colors.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _obscurePassword = true;
  bool _biometricAvailable = false;
  bool _biometricEnabled = false;
  String? _biometricType;

  @override
  void initState() {
    super.initState();
    _checkBiometric();
  }

  Future<void> _checkBiometric() async {
    final bio = BiometricService();
    final available = await bio.isBiometricAvailable;
    final enabled = await bio.isEnabled;
    if (mounted) {
      setState(() {
        _biometricAvailable = available;
        _biometricEnabled = enabled;
      });
    }
    if (available) {
      final typeName = await bio.getBiometricTypeName();
      if (mounted) {
        setState(() => _biometricType = typeName);
      }
      if (enabled) {
        _attemptBiometricLogin();
      }
    }
  }

  Future<void> _attemptBiometricLogin() async {
    final bio = BiometricService();
    final authenticated = await bio.authenticate(
      reason: 'Gunakan $_biometricType untuk login ke ReLoop',
    );
    if (!authenticated || !mounted) return;

    final creds = await bio.getCredentials();
    if (creds == null || !mounted) return;

    _emailCtrl.text = creds.email;
    _passwordCtrl.text = creds.password;
    await _login();
  }

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;

    final auth = context.read<AuthProvider>();
    final success = await auth.login(
      _emailCtrl.text.trim(),
      _passwordCtrl.text,
    );

    if (success && mounted) {
      final bio = BiometricService();
      if (await bio.isEnabled) {
        await bio.saveCredentials(
          _emailCtrl.text.trim(),
          _passwordCtrl.text,
        );
      }
      context.go(auth.dashboardRoute);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    color: ReLoopColors.brand500,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: const Icon(
                    Icons.recycling,
                    color: Colors.white,
                    size: 36,
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  'Masuk ke ReLoop',
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: ReLoopColors.foreground,
                      ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Kelola sampah, dapatkan reward',
                  style: TextStyle(color: ReLoopColors.muted, fontSize: 14),
                ),
                const SizedBox(height: 32),
                Form(
                  key: _formKey,
                  child: Column(
                    children: [
                      TextFormField(
                        controller: _emailCtrl,
                        keyboardType: TextInputType.emailAddress,
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(
                          labelText: 'Email',
                          hintText: 'contoh@email.com',
                          prefixIcon: Icon(Icons.email_outlined),
                        ),
                        validator: (v) {
                          if (v == null || v.trim().isEmpty) {
                            return 'Email wajib diisi';
                          }
                          final emailRegex = RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$');
                          if (!emailRegex.hasMatch(v.trim())) {
                            return 'Format email tidak valid';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _passwordCtrl,
                        obscureText: _obscurePassword,
                        textInputAction: TextInputAction.done,
                        onFieldSubmitted: (_) => _login(),
                        decoration: InputDecoration(
                          labelText: 'Password',
                          prefixIcon: const Icon(Icons.lock_outlined),
                          suffixIcon: IconButton(
                            icon: Icon(
                              _obscurePassword
                                  ? Icons.visibility_off_outlined
                                  : Icons.visibility_outlined,
                            ),
                            onPressed: () {
                              setState(() {
                                _obscurePassword = !_obscurePassword;
                              });
                            },
                          ),
                        ),
                        validator: (v) {
                          if (v == null || v.isEmpty) {
                            return 'Password wajib diisi';
                          }
                          if (v.length < 6) {
                            return 'Password minimal 6 karakter';
                          }
                          return null;
                        },
                      ),
                    ],
                  ),
                ),
                if (auth.error != null) ...[
                  const SizedBox(height: 16),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: ReLoopColors.tones['danger']!.bg,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: ReLoopColors.tones['danger']!.border),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.error_outline,
                            size: 18, color: ReLoopColors.danger),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            auth.error!,
                            style: const TextStyle(
                              color: ReLoopColors.danger,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 24),
                ReLoopButton(
                  label: 'Masuk',
                  onPressed: auth.isLoading ? null : _login,
                  isLoading: auth.isLoading,
                  size: ReLoopButtonSize.lg,
                ),
                if (_biometricAvailable && _biometricEnabled) ...[
                  const SizedBox(height: 16),
                  const Text(
                    'atau',
                    style: TextStyle(color: ReLoopColors.mutedSoft, fontSize: 13),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: _attemptBiometricLogin,
                    icon: Icon(
                      _biometricType == 'Face ID'
                          ? Icons.face
                          : Icons.fingerprint,
                      color: ReLoopColors.brand600,
                    ),
                    label: Text(
                      'Login dengan $_biometricType',
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                      ),
                    ),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: ReLoopColors.brand600,
                      side: const BorderSide(color: ReLoopColors.brand200),
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                TextButton(
                  onPressed: () => context.push('/register'),
                  child: const Text.rich(
                    TextSpan(
                      text: 'Belum punya akun? ',
                      style: TextStyle(color: ReLoopColors.muted),
                      children: [
                        TextSpan(
                          text: 'Daftar',
                          style: TextStyle(
                            color: ReLoopColors.brand600,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
