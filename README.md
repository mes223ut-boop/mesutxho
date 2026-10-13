# Mesutxho Firebase kurulumu

## Oturum verisi ve erişim

- Google girişi, kullanıcı bilgilendirme kutusunu işaretleyene kadar etkinleşmez.
- `script.js` ile `admin.js`, ortak `session-records.js` modülünü kullanarak yeni oturumları doğrudan Firestore `sessions` koleksiyonuna yazar. Cloud Functions uygulama akışında kullanılmaz.
- Oturum belgesi Google kullanıcısının UID/e-posta/ad/fotoğrafını, onay sürümünü, sunucu zaman damgasını, tarayıcı/cihaz bilgisini ve tarayıcının izin verdiği pil/ağ metaverisini içerir. IP/şehir bilgisi bu istemci kayıtlarında toplanmaz.
- `createdAt` Firestore `serverTimestamp()` ile yazılır. `expiresAt` 90 günlük TTL silme süresi içindir; istemci yazımı Firestore kurallarıyla 89-91 gün aralığında doğrulanır.
- Kullanıcı yalnızca kendi UID'siyle, onaylı ve şemaya uyan kayıt oluşturabilir. İstemci kayıtları güncelleyemez veya silemez. Kayıtları yalnızca e-postası `mes223ut@gmail.com`, e-postası doğrulanmış ve oturumu Google sağlayıcısından gelen hesap okuyabilir. Gerçek erişim sınırı Firestore Security Rules'dur; arayüzdeki e-posta kontrolü tek başına güvenlik sağlamaz.
- `admin.html`, `sessions` koleksiyonunu `onSnapshot` ile dinler; tablo ve özet sayıları yeni kayıtlarla canlı güncellenir. Yalnızca en yeni 100 kayıt tabloda gösterilir.
- Firebase/Google Cloud projesinde uygun IAM yetkileri olan proje sahipleri ve yöneticileri veritabanına altyapı üzerinden de erişebilir; bu kişilerin erişimini Google Cloud IAM ile sınırlandırın.

Bu açıklama gizlilik/KVKK yükümlülüklerinin veya hukuki danışmanlığın yerine geçmez. Yayına almadan önce kendi veri sorumlusu bilgilerinizi, amaçları, yasal dayanağı ve ilgili hakları kapsayan gizlilik metninizi hazırlayın. Bu istemci tabanlı kayıt yaklaşımı IP adresi toplamaz.

## Yayına almadan önce

1. Firebase Console > Authentication > Sign-in method bölümünde **Google** sağlayıcısını etkinleştirin.
2. Firebase Console > Firestore Database bölümünden veritabanı oluşturun. Veri yerleşimi için uygun konumu seçin.
3. Firebase Console > Authentication > Settings > Authorized domains bölümünde geliştirme ve dağıtım alan adlarınızın bulunduğunu kontrol edin.
4. Firebase Console > Firestore Database > Rules bölümüne [firestore.rules](./firestore.rules) içeriğini yapıştırıp **Publish** seçin. Admin e-postası `firebase-config.js` ile aynı olmalıdır.
5. 90 günlük otomatik silme için her iki koleksiyon grubunda da TTL etkinleştirin:

   ```powershell
   gcloud firestore fields ttls update expiresAt --collection-group=sessions --database="(default)" --enable-ttl --project=mesutxo
   gcloud firestore fields ttls update expiresAt --collection-group=loginSessions --database="(default)" --enable-ttl --project=mesutxo
   ```

   TTL silmeleri anlık değildir; Firestore kayıtları süre dolduktan sonra arka planda siler. `loginSessions`, eski sürümün verilerini korumak için kurallarda ve TTL ayarında tutulur; admin panelinin yeni canlı akışı `sessions` koleksiyonunu kullanır.

6. Hosting ve Firestore kurallarını yayımlayın:

   ```powershell
   firebase deploy --project mesutxo --only firestore:rules,hosting
   ```

7. `https://mesutxo.web.app/` ve `https://mesutxo.web.app/admin.html` adreslerini deneyin. Yöneticinin doğrulanmış Google e-postası `mes223ut@gmail.com` olmalıdır.

Bu proje artık `firebase-functions` istemci SDK'sına veya Functions dağıtımına bağlı değildir. Daha önce dağıtılmış `recordSignIn` Cloud Function varsa yeni kod tarafından çağrılmaz; Firebase Console > Functions bölümünden eski işlevi, artık kullanmadığınızdan emin olduktan sonra ayrıca kaldırabilirsiniz.

Google girişinde `auth/configuration-not-found` hatası alınırsa Firebase Console'da Authentication hizmetinin başlatıldığını ve Google sağlayıcısının etkin olduğunu doğrulayın. Hata sürerse web uygulamasının `apiKey`, `projectId` ve `authDomain` değerlerinin aynı Firebase projesine ait olduğunu kontrol edin.

## Yerel önizleme

ES module importları `file://` üzerinden çalışmaz. Firebase Authentication ve Firestore için localhost veya HTTPS üzerinden sunun:

```powershell
python -m http.server 8080
```

Yerel giriş için `localhost` Firebase Authentication yetkili alan adlarına eklenmelidir. Firestore rules yayımlanmadan oturum kayıtları okunup yazılamaz.
