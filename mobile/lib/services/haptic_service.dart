import 'package:flutter/services.dart';

class HapticService {
  static final HapticService _instance = HapticService._();
  factory HapticService() => _instance;
  HapticService._();

  void light() {
    HapticFeedback.lightImpact();
  }

  void medium() {
    HapticFeedback.mediumImpact();
  }

  void heavy() {
    HapticFeedback.heavyImpact();
  }

  void selection() {
    HapticFeedback.selectionClick();
  }

  void success() {
    HapticFeedback.heavyImpact();
    Future.delayed(const Duration(milliseconds: 100), () {
      HapticFeedback.heavyImpact();
    });
  }

  void error() {
    HapticFeedback.vibrate();
  }
}
