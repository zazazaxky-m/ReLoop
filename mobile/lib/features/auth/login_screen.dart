import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/auth_provider.dart';
import '../../services/biometric_service.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/reloop_logo.dart';
import '../../theme/colors.dart';
import '../../theme/dimens.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key}); // coverage:ignore-line

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
    // coverage:ignore-start
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
    // coverage:ignore-end
  }

  // coverage:ignore-start
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
  // coverage:ignore-end

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
      TextInput.finishAutofillContext();
      final bio = BiometricService();
      // coverage:ignore-start
      if (await bio.isEnabled) {
        await bio.saveCredentials(
          _emailCtrl.text.trim(),
          _passwordCtrl.text,
        );
      }
      // coverage:ignore-end
      if (!mounted) return;
      context.go(auth.dashboardRoute);
    }
  }

  Widget _buildLabel(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: ReLoopSpacing.sm),
      child: RichText(
        text: TextSpan(
          text: text,
          style: TextStyle(
            color: context.reloopForeground,
            fontSize: 13,
            fontWeight: FontWeight.w700,
          ),
          children: const [
            TextSpan(
              text: ' *',
              style: TextStyle(color: ReLoopColors.danger),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    return Scaffold(
      backgroundColor: context.reloopBackground,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(
            horizontal: ReLoopSpacing.xl,
            vertical: ReLoopSpacing.xxl,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const ReLoopLogo(height: 36),
              ReLoopSpacing.gap24,
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(ReLoopSpacing.xxl),
                decoration: BoxDecoration(
                  color: context.reloopSurfaceRaised,
                  borderRadius: ReLoopRadius.brLg,
                  border: Border.all(color: context.reloopBorder),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: context.isDarkMode ? .38 : .08),
                      blurRadius: 24,
                      offset: const Offset(0, 10),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'SELAMAT DATANG KEMBALI',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.6,
                        color: context.reloopBrandText,
                      ),
                    ),
                    ReLoopSpacing.gap8,
                    Text(
                      'Masuk ke ReLoop',
                      style: TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w900,
                        color: context.reloopForeground,
                        letterSpacing: -0.5,
                      ),
                    ),
                    ReLoopSpacing.gap8,
                    Text(
                      'Lanjutkan aksi baikmu dari sini.',
                      style: TextStyle(
                        color: context.reloopMuted,
                        fontSize: 14,
                        height: 1.5,
                      ),
                    ),
                    const SizedBox(height: ReLoopSpacing.xxl),
                    Form(
                      key: _formKey,
                      child: AutofillGroup(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                          _buildLabel('Email'),
                          TextFormField(
                            controller: _emailCtrl,
                            keyboardType: TextInputType.emailAddress,
                            textInputAction: TextInputAction.next,
                            autofillHints: const [AutofillHints.email],
                            style: TextStyle(
                                fontSize: 15, color: context.reloopForeground),
                            decoration: InputDecoration(
                              hintText: 'nama@email.com',
                              prefixIcon: Icon(
                                Icons.mail_outline,
                                size: 20,
                                color: context.reloopMutedSoft,
                              ),
                            ),
                            validator: (v) {
                              if (v == null || v.trim().isEmpty) {
                                return 'Email wajib diisi';
                              }
                              final emailRegex =
                                  RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$');
                              if (!emailRegex.hasMatch(v.trim())) {
                                return 'Format email tidak valid';
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: ReLoopSpacing.lg),
                          _buildLabel('Password'),
                          TextFormField(
                            controller: _passwordCtrl,
                            obscureText: _obscurePassword,
                            autocorrect: false,
                            enableSuggestions: false,
                            keyboardType: TextInputType.visiblePassword,
                            textInputAction: TextInputAction.done,
                            autofillHints: const [AutofillHints.password],
                            onFieldSubmitted: (_) => _login(),
                            style: TextStyle(
                                fontSize: 15, color: context.reloopForeground),
                            decoration: InputDecoration(
                              hintText: '••••••••',
                              prefixIcon: Icon(
                                Icons.lock_outline,
                                size: 20,
                                color: context.reloopMutedSoft,
                              ),
                              suffixIcon: IconButton(
                                icon: Icon(
                                  _obscurePassword
                                      ? Icons.visibility_off_outlined
                                      : Icons.visibility_outlined,
                                  size: 20,
                                  color: context.reloopMutedSoft,
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
                          Align(
                            alignment: Alignment.centerRight,
                            child: TextButton(
                              onPressed: () => context.push('/forgot-password'),
                              style: TextButton.styleFrom(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 0,
                                  vertical: ReLoopSpacing.sm,
                                ),
                                minimumSize: Size.zero,
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              ),
                              child: Text(
                                'Lupa kata sandi?',
                                style: TextStyle(
                                  color: context.reloopBrandText,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                      ),
                    ),
                    if (auth.error != null) ...[
                      const SizedBox(height: ReLoopSpacing.lg),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(ReLoopSpacing.md),
                        decoration: BoxDecoration(
                          color: context.reloopTone('danger').bg,
                          borderRadius: ReLoopRadius.brSm,
                          border: Border.all(color: context.reloopTone('danger').border),
                        ),
                        child: Row(
                          children: [
                            Icon(Icons.error_outline,
                                size: 16, color: context.reloopTone('danger').text),
                            ReLoopSpacing.gap8,
                            Expanded(
                              child: Text(
                                auth.error!,
                                style: TextStyle(
                                  color: context.reloopTone('danger').text,
                                  fontSize: 13,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: ReLoopSpacing.xxl),
                    SizedBox(
                      width: double.infinity,
                      child: ReLoopButton(
                        label: 'Masuk',
                        onPressed: auth.isLoading ? null : _login,
                        isLoading: auth.isLoading,
                        size: ReLoopButtonSize.lg,
                      ),
                    ),
                    // coverage:ignore-start
                    if (_biometricAvailable && _biometricEnabled) ...[
                      const SizedBox(height: ReLoopSpacing.lg),
                      Center(
                        child: Text(
                          'atau',
                          style: TextStyle(
                              color: context.reloopMutedSoft, fontSize: 13),
                        ),
                      ),
                      const SizedBox(height: ReLoopSpacing.md),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: _attemptBiometricLogin,
                          icon: Icon(
                            _biometricType == 'Face ID'
                                ? Icons.face
                                : Icons.fingerprint,
                            color: context.reloopBrandText,
                          ),
                          label: Text(
                            'Login dengan $_biometricType',
                            style: const TextStyle(
                              fontWeight: FontWeight.w600,
                              fontSize: 14,
                            ),
                          ),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: context.reloopBrandText,
                            side: BorderSide(
                                color: context.reloopBrandSoftStrong),
                            minimumSize:
                                const Size.fromHeight(ReLoopA11y.minTouchTarget),
                            padding: const EdgeInsets.symmetric(
                                vertical: ReLoopSpacing.lg),
                            shape: const RoundedRectangleBorder(
                              borderRadius: ReLoopRadius.brMd,
                            ),
                          ),
                        ),
                      ),
                    ],
                    // coverage:ignore-end
                    const SizedBox(height: ReLoopSpacing.xxl),
                    Align(
                      alignment: Alignment.center,
                      child: GestureDetector(
                        onTap: () => context.push('/register'),
                        child: Text.rich(
                          TextSpan(
                            text: 'Belum punya akun? ',
                            style: TextStyle(
                              color: context.reloopMutedSoft,
                              fontSize: 14,
                            ),
                            children: [
                              TextSpan(
                                text: 'Daftar',
                                style: TextStyle(
                                  color: context.reloopBrandText,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: ReLoopSpacing.xxl),
              Align(
                alignment: Alignment.center,
                child: GestureDetector(
                  onTap: () {
                    context.go('/onboarding');
                  },
                  child: Text(
                    '← Kembali ke pengenalan',
                    style: TextStyle(
                      color: context.reloopMutedSoft,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

