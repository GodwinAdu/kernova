"""Kernova Python SDK — HTTP client for the Kernova Gateway API."""
import httpx
from typing import Optional, Dict, Any, List, AsyncIterator
from dataclasses import dataclass

@dataclass
class IntentResult:
    id: str
    status: str
    success: bool
    answer: str
    duration_ms: Optional[int] = None

@dataclass  
class HealthStatus:
    running: bool
    agents: int
    active_intents: int

class Kernova:
    """Synchronous Kernova client."""
    
    def __init__(self, base_url: str = "http://localhost:3000", api_key: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.headers = {"Content-Type": "application/json"}
        if api_key:
            self.headers["Authorization"] = f"Bearer {api_key}"
    
    def ask(self, goal: str, type: str = "query", priority: str = "medium", owner: Optional[str] = None) -> IntentResult:
        """Submit an intent and get the result."""
        body = {"goal": goal, "type": type, "priority": priority}
        if owner:
            body["owner"] = owner
        
        with httpx.Client() as client:
            response = client.post(f"{self.base_url}/v1/intents", json=body, headers=self.headers, timeout=120)
            response.raise_for_status()
            data = response.json()
        
        return IntentResult(
            id=data.get("id", ""),
            status=data.get("status", ""),
            success=data.get("result", {}).get("success", False),
            answer=data.get("result", {}).get("summary", ""),
            duration_ms=data.get("result", {}).get("durationMs"),
        )
    
    def chat(self, messages: List[Dict[str, str]], model: str = "kernova") -> str:
        """OpenAI-compatible chat completion."""
        body = {"model": model, "messages": messages}
        
        with httpx.Client() as client:
            response = client.post(f"{self.base_url}/v1/chat/completions", json=body, headers=self.headers, timeout=120)
            response.raise_for_status()
            data = response.json()
        
        return data["choices"][0]["message"]["content"]
    
    def health(self) -> HealthStatus:
        """Check gateway health."""
        with httpx.Client() as client:
            response = client.get(f"{self.base_url}/health", headers=self.headers)
            response.raise_for_status()
            data = response.json()
        
        return HealthStatus(
            running=data.get("running", False),
            agents=data.get("agents", 0),
            active_intents=data.get("activeIntents", 0),
        )


class AsyncKernova:
    """Async Kernova client."""
    
    def __init__(self, base_url: str = "http://localhost:3000", api_key: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.headers = {"Content-Type": "application/json"}
        if api_key:
            self.headers["Authorization"] = f"Bearer {api_key}"
    
    async def ask(self, goal: str, type: str = "query", priority: str = "medium") -> IntentResult:
        body = {"goal": goal, "type": type, "priority": priority}
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{self.base_url}/v1/intents", json=body, headers=self.headers, timeout=120)
            response.raise_for_status()
            data = response.json()
        
        return IntentResult(
            id=data.get("id", ""),
            status=data.get("status", ""),
            success=data.get("result", {}).get("success", False),
            answer=data.get("result", {}).get("summary", ""),
        )
    
    async def chat(self, messages: List[Dict[str, str]]) -> str:
        body = {"model": "kernova", "messages": messages}
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{self.base_url}/v1/chat/completions", json=body, headers=self.headers, timeout=120)
            response.raise_for_status()
            data = response.json()
        return data["choices"][0]["message"]["content"]
    
    async def health(self) -> HealthStatus:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.base_url}/health", headers=self.headers)
            response.raise_for_status()
            data = response.json()
        return HealthStatus(running=data.get("running", False), agents=data.get("agents", 0), active_intents=data.get("activeIntents", 0))
