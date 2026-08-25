const AUTH_STORAGE_KEY = "copyvibe.authenticated";

export const APP_PASSWORD = "Talkoot!";

export const isAuthenticated = () => {
  try {
    return window.localStorage.getItem(AUTH_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export const loginWithPassword = (password: string) => {
  const success = password === APP_PASSWORD;
  if (success) {
    window.localStorage.setItem(AUTH_STORAGE_KEY, "true");
  }
  return success;
};

export const logout = () => {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
};
