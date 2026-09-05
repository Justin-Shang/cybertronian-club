import { useEffect } from "react";
import { useLocation } from "wouter";

export default function ModelRouterIndex() {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/model-router/cybertron"); }, [navigate]);
  return null;
}
