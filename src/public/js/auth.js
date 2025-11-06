// public/js/auth.js
(function () {
  async function onSubmit(ev) {
    ev.preventDefault();
    const form = ev.target;
    const payload = Object.fromEntries(new FormData(form).entries());

    try {
      let data;
      if (window.AUTH_MODE === "login") {
        data = await API.post("/api/auth/login", payload);
      } else {
        data = await API.post("/api/auth/register", payload);
      }
      // Nếu backend có trả token JSON thì lưu; nếu không, vẫn ổn vì đã có cookie httpOnly
      if (data && data.token) API.setToken(data.token);

      location.href = "/";
    } catch (err) {
      toast(err.message || "Thao tác thất bại");
    }
  }

  const f1 = document.getElementById("loginForm");
  const f2 = document.getElementById("registerForm");
  (f1 || f2)?.addEventListener("submit", onSubmit);
})();
