local o = vim.opt

-- Basic settings
o.number = true
o.relativenumber = true
o.ignorecase = true
o.smartcase = true
o.tabstop = 2
o.softtabstop = 0
o.shiftwidth = 2
o.expandtab = true
o.wrap = false
o.autoread = true
o.swapfile = false
o.backup = false
o.hlsearch = false
o.splitright = true
o.mouse = ""
o.spell = true
o.spelloptions = "camel"
o.cmdheight = 0

if vim.fn.has("termguicolors") == 1 then
	o.termguicolors = true
end
