# ReLoop Mobile - Implementation Plan

## Overview
Implementation plan untuk menambahkan fitur-fitur yang belum ada di mobile app ReLoop, berdasarkan perbandingan dengan web version dan best practice mobile development.

---

## Phase 1: Critical Features (Week 1-2)
**Goal:** Fitur-fitur essential yang ada di web tapi belum ada di mobile

### 1.1 Push Notification System
**Estimasi:** 2-3 hari

#### Backend Setup
- [ ] Setup Firebase Cloud Messaging (FCM) project
- [ ] Generate `google-services.json` (Android) & `GoogleService-Info.plist` (iOS)
- [ ] Create API endpoint untuk register device token: `POST /api/devices/register`
- [ ] Create notification service di backend untuk trigger notifikasi

#### Mobile Implementation
- [ ] Add `firebase_core`, `firebase_messaging`, `flutter_local_notifications` ke pubspec.yaml
- [ ] Create `lib/services/notification_service.dart`
  ```dart
  - initialize()
  - requestPermission()
  - getToken()
  - onMessage()
  - onBackgroundMessage()
  ```
- [ ] Register device token setelah login berhasil
- [ ] Handle notification tap untuk navigate ke screen terkait
- [ ] Create notification channels (Android)

#### Notification Triggers
- [ ] Session completed (reward earned)
- [ ] Pickup assigned/arrived (untuk pengepul)
- [ ] Redemption status changed
- [ ] Campaign reminder
- [ ] Machine full alert (untuk admin/pengepul)

#### Files to Create
- `lib/services/notification_service.dart`
- `lib/screens/notification_settings_screen.dart`

#### Files to Modify
- `pubspec.yaml` - add dependencies
- `lib/main.dart` - initialize FCM
- `lib/core/auth_provider.dart` - register device after login
- `lib/core/router.dart` - handle notification deep link

---

### 1.2 Redemption/Cairkan Saldo
**Estimasi:** 2 hari

#### Features
- [ ] Add payout account (bank/e-wallet)
- [ ] Request redemption (min amount validation)
- [ ] View redemption history
- [ ] Track redemption status

#### UI Components
- [ ] `RedemptionForm` - form untuk request pencairan
- [ ] `PayoutAccountForm` - form tambah rekening
- [ ] `RedemptionHistoryList` - list riwayat pencairan
- [ ] `RedemptionStatusTracker` - progress tracker

#### API Integration
- `POST /api/wallet/redemption` - create redemption request
- `GET /api/wallet/redemptions` - list redemptions
- `POST /api/wallet/payout-accounts` - add payout account
- `PATCH /api/wallet/payout-accounts/:id` - update account
- `DELETE /api/wallet/payout-accounts/:id` - delete account

#### Files to Create
- `lib/features/wallet/redemption_screen.dart`
- `lib/features/wallet/payout_account_form.dart`
- `lib/features/wallet/redemption_history.dart`
- `lib/core/models/redemption.dart`
- `lib/core/models/payout_account.dart`

#### Files to Modify
- `lib/features/wallet/wallet_screen.dart` - add redemption button
- `lib/core/router.dart` - add routes
- `lib/core/models.dart` - add models

---

### 1.3 Trash Bag Submission
**Estimasi:** 2 hari

#### Features
- [ ] Create trash bag submission
- [ ] Upload photo of trash bag
- [ ] Select waste type
- [ ] Track submission status
- [ ] View submission history

#### UI Components
- [ ] `TrashBagForm` - form dengan image picker
- [ ] `TrashBagHistory` - list submissions
- [ ] `TrashBagDetail` - detail view dengan status

#### API Integration
- `POST /api/trash-bags` - create submission (multipart)
- `GET /api/trash-bags` - list user's submissions
- `GET /api/trash-bags/:id` - get detail

#### Dependencies
- `image_picker` - untuk capture/upload foto
- `image_cropper` - crop foto sebelum upload
- `mime` - detect image type

#### Files to Create
- `lib/features/trash_bag/trash_bag_screen.dart`
- `lib/features/trash_bag/trash_bag_form.dart`
- `lib/features/trash_bag/trash_bag_history.dart`
- `lib/features/trash_bag/trash_bag_detail.dart`
- `lib/core/models/trash_bag.dart`

#### Files to Modify
- `pubspec.yaml` - add image_picker, image_cropper
- `lib/core/router.dart` - add routes
- `lib/core/router.dart` - add navigation to dashboard

---

## Phase 2: UX Improvements (Week 3-4)
**Goal:** Improve user experience dengan fitur-fitur mobile-native

### 2.1 Pagination & Infinite Scroll
**Estimasi:** 1-2 hari

#### Implementation
- [ ] Create `PaginatedList` widget dengan infinite scroll
- [ ] Implement cursor-based pagination untuk:
  - Wallet history
  - Session history
  - Campaign list
  - Pickup tasks

#### Widget Design
```dart
class PaginatedList<T> extends StatefulWidget {
  final Future<List<T> Function(String? cursor)> fetcher;
  final Widget Function(T item) itemBuilder;
  final Widget? emptyState;
}
```

#### Files to Create
- `lib/shared/widgets/paginated_list.dart`
- `lib/shared/widgets/loading_indicator.dart`

#### Files to Modify
- `lib/features/wallet/wallet_screen.dart`
- `lib/features/dashboard/user_dashboard_screen.dart`
- `lib/features/campaigns/campaigns_screen.dart`
- `lib/features/pickup/pickup_screen.dart`

---

### 2.2 Biometric Authentication
**Estimasi:** 1 hari

#### Features
- [ ] Enable/disable biometric di settings
- [ ] Quick login dengan fingerprint/face ID
- [ ] Fallback ke PIN/password

#### Dependencies
- `local_auth` - untuk biometric authentication
- `flutter_secure_storage` - sudah ada, untuk store preference

#### Implementation
- [ ] Create `BiometricService`
- [ ] Add biometric toggle di Profile/Settings
- [ ] Integrate dengan login flow
- [ ] Handle biometric not available/enrolled

#### Files to Create
- `lib/services/biometric_service.dart`
- `lib/features/settings/biometric_settings.dart`

#### Files to Modify
- `pubspec.yaml` - add local_auth
- `lib/features/auth/login_screen.dart` - add biometric option
- `lib/features/profile/profile_screen.dart` - add settings link

---

### 2.3 Dark Mode
**Estimasi:** 2 hari

#### Implementation
- [ ] Create `AppTheme.dark` theme
- [ ] Add theme provider dengan persistence
- [ ] System theme detection
- [ ] Theme toggle di settings

#### Color Mapping
| Light | Dark |
|-------|------|
| `background: #F3F7F5` | `background: #0F1A14` |
| `surface: #FFFFFF` | `surface: #1A2A22` |
| `foreground: #14211A` | `foreground: #F3F7F5` |
| `border: #DCE6DF` | `border: #2A3A32` |

#### Files to Create
- `lib/theme/dark_theme.dart`
- `lib/providers/theme_provider.dart`

#### Files to Modify
- `lib/theme/app_theme.dart` - add dark theme
- `lib/theme/colors.dart` - add dark color variants
- `lib/main.dart` - wrap with theme provider
- `lib/features/profile/profile_screen.dart` - add theme toggle
- All screens - ensure dark mode compatible

---

## Phase 3: Technical Foundation (Week 5-6)
**Goal:** Improve code quality, testing, dan observability

### 3.1 Widget Tests
**Estimasi:** 3-4 hari

#### Test Coverage Target: 70%

#### Priority Tests
1. **Auth Flow**
   - [ ] Login form validation
   - [ ] Login success/failure
   - [ ] Register form validation
   - [ ] Auth redirect logic

2. **Dashboard**
   - [ ] Balance card display
   - [ ] Quick action navigation
   - [ ] Session list rendering
   - [ ] Empty state display

3. **Wallet**
   - [ ] Balance formatting
   - [ ] Transaction list
   - [ ] Redemption form validation

4. **Shared Widgets**
   - [ ] ReLoopButton states
   - [ ] ReLoopCard rendering
   - [ ] StatusBadge mapping
   - [ ] Skeleton loading animation

#### Files to Create
- `test/features/auth/login_screen_test.dart`
- `test/features/auth/register_screen_test.dart`
- `test/features/dashboard/user_dashboard_screen_test.dart`
- `test/features/wallet/wallet_screen_test.dart`
- `test/shared/widgets/reloop_button_test.dart`
- `test/shared/widgets/status_badge_test.dart`
- `test/core/auth_provider_test.dart`
- `test/core/api_client_test.dart`

#### Test Utilities
- `test/helpers/mock_api_client.dart`
- `test/helpers/mock_auth_provider.dart`
- `test/helpers/test_helpers.dart`

---

### 3.2 Integration Tests
**Estasi:** 2 hari

#### Test Scenarios
1. **Login Flow**
   - [ ] Enter credentials → Submit → Redirect to dashboard
   - [ ] Invalid credentials → Show error
   - [ ] Network error → Show error message

2. **Scan Flow**
   - [ ] Open scanner → Scan QR → Show result
   - [ ] Invalid QR → Show error
   - [ ] Resume session → Show resumed state

3. **Wallet Flow**
   - [ ] View balance → Request redemption → Track status

#### Files to Create
- `integration_test/app_test.dart`
- `integration_test/auth_flow_test.dart`
- `integration_test/scan_flow_test.dart`
- `integration_test/wallet_flow_test.dart`

---

### 3.3 Analytics & Crash Reporting
**Estimasi:** 1-2 hari

#### Firebase Analytics
- [ ] Track screen views
- [ ] Track key events:
  - Login/Register success
  - Scan completed
  - Redemption requested
  - Campaign viewed
- [ ] Track user properties (role, organization)

#### Firebase Crashlytics
- [ ] Capture unhandled exceptions
- [ ] Add breadcrumbs untuk user actions
- [ ] Log non-fatal errors

#### Dependencies
- `firebase_analytics`
- `firebase_crashlytics`

#### Files to Create
- `lib/services/analytics_service.dart`
- `lib/services/crashlytics_service.dart`

#### Files to Modify
- `pubspec.yaml` - add dependencies
- `lib/main.dart` - initialize services
- `lib/core/router.dart` - track screen views
- `lib/core/auth_provider.dart` - track auth events

---

### 3.4 Environment Configuration
**Estimasi:** 1 hari

#### Setup
- [ ] Create `.env` files untuk dev/staging/prod
- [ ] Use `flutter_dotenv` atau `flutter_config`
- [ ] Environment-specific API base URLs
- [ ] Environment-specific Firebase config

#### Files to Create
- `.env.development`
- `.env.staging`
- `.env.production`
- `lib/config/environment.dart`

#### Files to Modify
- `pubspec.yaml` - add flutter_dotenv
- `lib/main.dart` - load environment
- `lib/core/api_client.dart` - use env base URL

---

## Phase 4: Additional Features (Week 7-8)
**Goal:** Fitur-fitur tambahan untuk parity dengan web

### 4.1 Machine Detail Screen
**Estimasi:** 2 hari

#### Features
- [ ] Machine info (name, code, organization)
- [ ] Real-time status & fill level
- [ ] Supported waste types
- [ ] Location map
- [ ] Recent sessions di mesin ini
- [ ] Report issue button

#### API Integration
- `GET /api/machines/:code` - machine detail
- `GET /api/machines/:code/sessions` - recent sessions
- `POST /api/machines/:code/report` - report issue

#### Files to Create
- `lib/features/machine/machine_detail_screen.dart`
- `lib/features/machine/machine_report_form.dart`

#### Files to Modify
- `lib/features/map/map_screen.dart` - navigate to detail
- `lib/core/router.dart` - add route

---

### 4.2 Pengepul Area Map
**Estimasi:** 2 hari

#### Features
- [ ] Map dengan area boundary
- [ ] Assigned machines dalam area
- [ ] Navigation ke mesin
- [ ] Area statistics

#### Dependencies
- `flutter_map` - sudah ada
- `flutter_map_polygon` - untuk area boundary

#### Files to Create
- `lib/features/pengepul/area_map_screen.dart`
- `lib/features/pengepul/area_stats.dart`

---

### 4.3 Deep Linking
**Estimasi:** 1 hari

#### Supported Links
- `reloop://scan?machine=XXX` - langsung ke scan result
- `reloop://campaign/:id` - langsung ke campaign detail
- `reloop://wallet/redemption` - langsung ke redemption

#### Implementation
- [ ] Setup deep link di Android (intent-filter)
- [ ] Setup deep link di iOS (associated domains)
- [ ] Handle incoming links di router

#### Files to Modify
- `android/app/src/main/AndroidManifest.xml`
- `ios/Runner/Info.plist`
- `lib/core/router.dart` - handle deep links

---

## Phase 5: Polish (Week 9-10)
**Goal:** Final polish dan nice-to-have features

### 5.1 Onboarding
**Estimasi:** 1-2 hari

#### Features
- [ ] 3-4 slide onboarding
- [ ] Skip button
- [ ] Get started button
- [ ] Store onboarding completed flag

#### Slides
1. Welcome to ReLoop
2. Scan & Earn Rewards
3. Track Your Impact
4. Cash Out Anytime

#### Dependencies
- `smooth_page_indicator` - untuk dots indicator

#### Files to Create
- `lib/features/onboarding/onboarding_screen.dart`
- `lib/features/onboarding/onboarding_page.dart`

---

### 5.2 Haptic Feedback
**Estimasi:** 0.5 hari

#### Implementation Points
- [ ] Scan success - success haptic
- [ ] Button press - light haptic
- [ ] Error - error haptic
- [ ] Pull to refresh - impact haptic

#### Files to Modify
- `lib/features/scan/scan_screen.dart`
- `lib/shared/widgets/reloop_button.dart`
- All screens with pull-to-refresh

---

### 5.3 Share Feature
**Estimasi:** 0.5 hari

#### Shareable Content
- [ ] Campaign link
- [ ] Referral code
- [ ] Achievement/badge

#### Dependencies
- `share_plus` - native share sheet

#### Files to Modify
- `pubspec.yaml` - add share_plus
- `lib/features/campaigns/campaigns_screen.dart` - add share button

---

### 5.4 App Icon & Splash
**Estimasi:** 0.5 hari

#### Implementation
- [ ] Design app icon (multiple sizes)
- [ ] Native splash screen (Android/iOS)
- [ ] Adaptive icon untuk Android

#### Dependencies
- `flutter_launcher_icons`
- `flutter_native_splash`

#### Files to Create
- `assets/icon/icon.png` (1024x1024)
- `assets/splash/splash.png`

#### Files to Modify
- `pubspec.yaml` - add config
- `android/app/src/main/AndroidManifest.xml`
- `ios/Runner/Info.plist`

---

## Summary

| Phase | Duration | Features |
|-------|----------|----------|
| **Phase 1** | 2 weeks | Push Notification, Redemption, Trash Bag |
| **Phase 2** | 2 weeks | Pagination, Biometric, Dark Mode |
| **Phase 3** | 2 weeks | Tests, Analytics, Environment Config |
| **Phase 4** | 2 weeks | Machine Detail, Pengepul Area, Deep Link |
| **Phase 5** | 2 weeks | Onboarding, Haptic, Share, App Icon |

**Total Estimated Time:** 10 weeks

---

## Dependencies to Add

```yaml
dependencies:
  # Phase 1
  firebase_core: ^2.24.0
  firebase_messaging: ^14.7.0
  flutter_local_notifications: ^17.0.0
  image_picker: ^1.0.0
  image_cropper: ^5.0.0
  mime: ^1.0.0
  
  # Phase 2
  local_auth: ^2.1.0
  
  # Phase 3
  firebase_analytics: ^10.8.0
  firebase_crashlytics: ^3.4.0
  flutter_dotenv: ^5.1.0
  
  # Phase 5
  smooth_page_indicator: ^1.1.0
  share_plus: ^7.0.0
  flutter_launcher_icons: ^0.13.0
  flutter_native_splash: ^2.3.0
```

---

## Next Steps

1. Review dan approve implementation plan
2. Setup Firebase project untuk Phase 1
3. Start dengan Push Notification (highest priority)
4. Weekly review untuk track progress
