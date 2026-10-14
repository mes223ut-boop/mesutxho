# Mesutxho Firebase kurulumu

## Kimlik doğrulama ve gizlilik

- Firebase Authentication'da **Google**, **Apple** ve **Anonymous** sağlayıcılarını etkinleştirin. Apple sağlayıcısı için Apple Developer bilgilerini Firebase Console'da yapılandırın; özel anahtarları depoya eklemeyin.
- Oturum kayıtları yalnızca kullanıcı genişletilmiş gizlilik bildirimindeki açık onayı verdiğinde yazılır. Onay vermeyen ziyaretçi misafir olarak siteye erişebilir ve oturum kaydı oluşturulmaz.
- Güvenlik denetimi, mümkün olduğunda içeriği göstermeden önce sunucu tarafında IP ve kullanıcı banlarını kontrol eder. Callable Function yanıt vermezse site kilitlenmez ve kullanıcı devam edebilir; bu fail-open davranışı servis kesintilerinde ban denetiminin geçici olarak uygulanamayabileceği anlamına gelir.
- Onaylı kayıtlarda IP adresi, ipapi.co/ipwho.is yedekli servisleri üzerinden yaklaşık ülke/şehir/bölge/posta kodu/enlem-boylam/zaman dilimi/ISP, giriş yöntemi, UID/e-posta/ad/profil fotoğrafı (kimlik sağlayıcısının verdiği ölçüde), cihaz türü/modeli, işletim sistemi ve sürümü, tarayıcı ve sürümü, User-Agent, ekran ve görünüm alanı çözünürlüğü, dil, istemci saat dilimi, sorgu parametreleri kaldırılmış referrer ve oturum süresi saklanır. Tarayıcı ayrıca public IP için ipapi.co, BigDataCloud ve ipify servislerini sırasıyla dener. Servis başına istek üç saniyede zaman aşımına uğrar; sağlayıcılar başarısız olsa da kayıt yerel/gizli IP ve bilinmeyen konumla devam eder. Erişim denetimi sunucu IP'sini alıp IP/kullanıcı banlarını kontrol eder; denetim servisine ulaşılamadığında statik site erişimi açık kalır.
- Admin panelindeki aktif kullanıcı sayısı, son beş dakika içindeki `lastSeen` değerlerine göre UID/oturum bazında hesaplanır. `lastSeen`, sayfada yeni kullanıcı etkileşimi varken süre güncelleme callable'ı aracılığıyla yenilenir.
- Oturum belgeleri `sessions` koleksiyonunda 90 günlük `expiresAt` TTL alanıyla tutulur. Süre güncellemeleri yalnızca oturumun sahibi olan kimliği doğrulanmış kullanıcı tarafından yapılabilir. TTL silme işlemi tam zamanında çalışmayabilir. IP ve kullanıcı ban kayıtları otomatik olarak sona ermez; panelden kaldırılmalıdır.
- Firestore güvenlik kuralları oturum, ban ve IP-ban kayıtlarına istemciden yazılmasını engeller. Ban işlemleri `functions/index.js` içindeki yönetici e-postasıyla sınırlı Callable Functions üzerinden yapılır. Admin panelindeki arayüz denetimi güvenlik sınırı değildir; asıl yetkilendirme Functions ve Firestore kurallarıdır.
- Yönetici e-postası hem `firebase-config.js`, `firestore.rules` hem de `functions/index.js` içinde `mes223ut@gmail.com` olmalıdır.
- Firebase proje yöneticileri veritabanına ve sunucu loglarına altyapı erişimi sağlayabilir. Erişimi Google Cloud IAM ile sınırlayın ve veri sorumlusu/yasal yükümlülükleriniz için kendi gizlilik metninizi hazırlayın. Bu açıklama hukuki danışmanlık değildir.

## Yayınlama

1. Firebase Console'da Authentication'ı başlatın; Google, Apple ve Anonymous giriş sağlayıcılarını etkinleştirin. Geliştirme ve dağıtım alan adlarını **Authorized domains** listesine ekleyin.
2. Firestore veritabanını oluşturun.
3. Node.js 22 ve Firebase CLI kurulu ortamda proje kökünden Functions bağımlılıklarını yükleyin:

   ```powershell
   Set-Location functions
   npm install
   Set-Location ..
   ```

4. Firestore kurallarını, Hosting'i ve Callable Functions'ı dağıtın:

   ```powershell
   firebase deploy --project mesutxo --only firestore:rules,functions,hosting
   ```

   Cloud Functions dağıtımı için Firebase projesinde faturalandırma/Blaze planı gerekebilir.

5. Firestore TTL bölümünde `sessions` koleksiyon grubu için `expiresAt` alanında TTL'yi etkinleştirin. TTL ayarı Firebase Console'da veya şu komutla yapılabilir:

   ```powershell
   gcloud firestore fields ttls update expiresAt --collection-group=sessions --database="(default)" --enable-ttl --project=mesutxo
   ```

6. `https://mesutxo.web.app/` ve `https://mesutxo.web.app/admin.html` adreslerinde Google, Apple, misafir, onay, log, ban ve ban kaldırma akışlarını test edin.

IP engeli sayfa açılırken ve açık sekmede 30 saniyelik aralıklarla Callable Function üzerinden kontrol edilir. Firebase Hosting bu projede statik HTML/CSS/JS sunar; bu nedenle IP engeli tarayıcı arayüzünü gizleyip uygulama erişimini durdurur ancak statik dosyaların HTTP yanıtını ağ katmanında engellemez. Statik dosya indirmesini de engellemek gerekiyorsa Hosting önüne IP denetimi uygulayan Cloud Run/proxy gibi sunucu taraflı bir katman koyun.

## Yerel önizleme

ES module importları `file://` üzerinden çalışmaz. Yerel bir HTTPS/localhost sunucusu kullanın:

```powershell
python -m http.server 8080
```

`localhost` alan adını Firebase Authentication yetkili alan adlarına ekleyin. Callable Functions'ı yerelde çalıştırmak için Firebase Emulator Suite yapılandırın; canlı Firebase projesine deploy edilmemiş Functions çağrıları başarısız olur.
